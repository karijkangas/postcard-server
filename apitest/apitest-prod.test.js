/*
 *
 */
/* eslint-disable no-use-before-define */
Error.stackTraceLimit = Infinity;
jest.setTimeout(30 * 1000);
process.env.AWS_SDK_LOAD_CONFIG = 'true';

const com = require('./apitest-common');
const sqs = require('./sqs');

const config = (function init() {
  const address = process.env.POSTCARD_API_ENDPOINT || 'http://minikube/v1';
  const url = new URL(address);
  const secure = url.protocol === 'https';
  const wsurl = new URL(address);
  wsurl.protocol = secure ? 'wss' : 'ws';
  wsurl.pathname = `${url.pathname}/endpoints`;

  return { ADDRESS: url.toString(), ENDPOINT_ADDRESS: wsurl.toString() };
})();

com.initialize(config);
sqs.initialize({
  URL: 'https://sqs.eu-west-1.amazonaws.com/521453527975/postcard-testing',
});

const TEST_EMAILS = [
  'postcard-testing@karijkangas.com',
  'postcard-testing-1@karijkangas.com',
  'postcard-testing-2@karijkangas.com',
  'postcard-testing-3@karijkangas.com',
  'postcard-testing-4@karijkangas.com',
];

const TEST_USERS = TEST_EMAILS.map((email, index) => {
  return Object.freeze({
    firstName: 'John',
    lastName: `Random-${index}-${Date.now()}`,
    email,
    password: com.randomPassword(),
    language: index % 2 ? 'en' : 'fi',
  });
});

const TEST_IMAGE_FILE_1 = {
  name: 'apitest/test-image1.png',
  contentType: 'image/png',
};

const TEST_IMAGE_FILE_2 = {
  name: 'apitest/test-image2.png',
  contentType: 'image/png',
};

/* ------------------------------------------------------------------
Debug API
*/

describe('Debug API', () => {
  test('Debug API should be disabled', async () => {
    await com.devGetUsers(404);
  });
});

/* ------------------------------------------------------------------
Service health
*/

describe('Service health', () => {
  const req = com.request();

  test('Service should be healthy', async () => {
    const r = await req.get('/healthz').expect(204);
    expect(r.body).toEqual({});
  });
});

/* ------------------------------------------------------------------
Register user
*/

describe('New user', () => {
  beforeAll(async () => {
    await sqs.clearQueue();
    for (let i = 0; i < TEST_USERS.length; i += 1) {
      const r = await com.checkAvailability({ email: TEST_USERS[i].email });
      expect(r).toEqual({ email: true });
    }
  });

  afterAll(async () => {
    for (let i = 0; i < TEST_USERS.length; i += 1) {
      const r = await com.checkAvailability({ email: TEST_USERS[i].email });
      expect(r).toEqual({ email: true });
    }
  });

  test('Registering new user should work', async () => {
    const user = { ...TEST_USERS[0] };

    let r = await com.checkAvailability({ email: user.email });
    expect(r).toEqual({ email: true });

    await com.requestRegistration(user);
    r = await sqs.pollRequestId();
    expect(r).toBeDefined();
    const { email, id } = r;
    expect(email).toEqual(user.email);

    await com.login(user, 400, { error: 'Invalid data' });

    r = await com.completeRegistrationRequest(id);
    expect(r).toBeDefined();
    expect(r.firstName).toEqual(user.firstName);
    expect(r.lastName).toEqual(user.lastName);
    expect(r.email).toEqual(user.email);

    r = await com.checkAvailability({ email: user.email });
    expect(r).toEqual({ email: false });

    await com.completeRegistrationRequest(id, 404, {
      error: 'Not found',
    });
    await com.requestRegistration(user, 409, { error: 'User already exists' });

    const s1 = await com.login(user);
    const { expires } = s1;

    await com.sleep(50);

    const s2 = await com.renewSession(s1);
    expect(s1.token).toEqual(s2.token);
    expect(s2.expires).toBeGreaterThan(expires);

    const data = await com.getUserData(s2);
    expect(data).toEqual({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      language: user.language,
      avatar: null,
    });

    await com.deleteAccount(s2, user);

    await com.getUserData(s2, 403, { error: 'Invalid session' });
    await com.login(user, 400, { error: 'Invalid data' });
    r = await com.checkAvailability({ email: user.email });
    expect(r).toEqual({ email: true });
  });
});

describe('Registered user', () => {
  const REGISTERED_USER_1 = { ...TEST_USERS[0] };
  const REGISTERED_USER_2 = { ...TEST_USERS[1] };
  const UNREGISTERED_USER_1 = { ...TEST_USERS[2] };
  const UNREGISTERED_USER_2 = { ...TEST_USERS[3] };

  beforeAll(async () => {
    await sqs.clearQueue();
    let u = [REGISTERED_USER_1, REGISTERED_USER_2];
    for (let i = 0; i < u.length; i += 1) {
      await com.requestRegistration(u[i]);
      const r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      const { id } = r;
      await com.completeRegistrationRequest(id);
    }
    u = [UNREGISTERED_USER_1, UNREGISTERED_USER_2];
    for (let i = 0; i < u.length; i += 1) {
      const r = await com.checkAvailability({ email: u[i].email });
      expect(r).toEqual({ email: true });
    }
  });

  afterAll(async () => {
    let u = [REGISTERED_USER_1, REGISTERED_USER_2];
    for (let i = 0; i < u.length; i += 1) {
      const s = await com.login(u[i]);
      await com.deleteAccount(s, u[i]);
    }
    u = [UNREGISTERED_USER_1, UNREGISTERED_USER_2];
    for (let i = 0; i < u.length; i += 1) {
      const r = await com.checkAvailability({ email: u[i].email });
      expect(r).toEqual({ email: true });
    }
  });

  /* ------------------------------------------------------------------
  Reset password
  */

  describe('Password reset', () => {
    test('Resetting password should work', async () => {
      const user = { ...UNREGISTERED_USER_1 };

      await com.requestRegistration(user);
      let r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      await com.completeRegistrationRequest(r.id);

      const s1 = await com.login(user);
      await com.logout(s1);

      await com.requestPasswordReset(user.email);
      r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      const { email, id } = r;
      expect(email).toEqual(user.email);

      const newPassword = com.randomPassword();
      expect(newPassword).not.toEqual(user.password);

      r = await com.completePasswordResetRequest(id, newPassword);
      expect(r).toBeDefined();
      expect(r.firstName).toEqual(user.firstName);
      expect(r.lastName).toEqual(user.lastName);
      expect(r.email).toEqual(user.email);

      await com.login(user, 400, { error: 'Invalid data' });

      user.password = newPassword;
      const s2 = await com.login(user);
      await com.deleteAccount(s2, user);
    });
  });

  /* ------------------------------------------------------------------
  Change email
  */

  describe('Change email', () => {
    test('Changing email should work', async () => {
      const user = { ...UNREGISTERED_USER_1 };

      await com.requestRegistration(user);
      let r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      await com.completeRegistrationRequest(r.id);

      const s1 = await com.login(user);

      const newEmail = UNREGISTERED_USER_2.email;
      await com.requestEmailChange(s1, { password: user.password, newEmail });

      await com.logout(s1);

      r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      const { email, id } = r;
      expect(email).toEqual(newEmail);
      await com.completeEmailChangeRequest(id);

      await com.login(user, 400, { error: 'Invalid data' });
      await com.completeEmailChangeRequest(id, 404, { error: 'Not found' });

      user.email = newEmail;
      const s2 = await com.login(user);
      await com.deleteAccount(s2, user);
    });
  });

  /* ------------------------------------------------------------------
Invite
*/

  describe('Invite', () => {
    test('Inviting new user should work', async () => {
      const user = { ...REGISTERED_USER_1 };
      const invitee = { ...UNREGISTERED_USER_1 };

      const s1 = await com.login(user);

      await com.invite(s1, invitee.email);
      let r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      const { email, id } = r;
      expect(email).toEqual(invitee.email);

      await com.invite(s1, invitee.email, 409, { error: 'Already invited' });
      await com.logout(s1);

      r = await com.completeInvite(id, invitee);
      expect(r).toBeDefined();
      expect(r.firstName).toEqual(invitee.firstName);
      expect(r.lastName).toEqual(invitee.lastName);
      expect(r.email).toEqual(invitee.email);

      await com.completeInvite(id, invitee, 404, { error: 'Not found' });

      const s2 = await com.login(invitee);
      const data = await com.getUserData(s2);
      expect(data).toEqual({
        firstName: invitee.firstName,
        lastName: invitee.lastName,
        email: invitee.email,
        language: invitee.language,
        avatar: null,
      });

      await com.deleteAccount(s2, invitee);
    });

    test('Rejecting invite should work', async () => {
      const user = { ...REGISTERED_USER_1 };
      const invitee = { ...UNREGISTERED_USER_1 };

      const s1 = await com.login(user);

      await com.invite(s1, invitee.email);
      let r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      const { email, id } = r;
      expect(email).toEqual(invitee.email);

      await com.rejectInviteRequest(id);

      await com.completeInvite(id, invitee, 404, { error: 'Not found' });
      await com.invite(s1, invitee.email, 409, { error: 'Do not disturb' });

      await com.logout(s1);

      /* register clears the DnD */
      await com.requestRegistration(invitee);
      r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      const { id: id2 } = r;
      await com.completeRegistrationRequest(id2);

      const s2 = await com.login(invitee);
      await com.deleteAccount(s2, invitee);
    });
  });

  /* ------------------------------------------------------------------
Change user data
*/

  describe('User data', () => {
    test('Changing password should work', async () => {
      const user = { ...UNREGISTERED_USER_1 };

      await com.requestRegistration(user);
      const r = await sqs.pollRequestId();
      expect(r).toBeDefined();
      await com.completeRegistrationRequest(r.id);

      const s1 = await com.login(user);

      const newPassword = com.randomPassword();
      await com.changePassword(s1, { password: user.password, newPassword });
      await com.logout(s1);

      await com.login(user, 400, { error: 'Invalid data' });

      user.password = newPassword;
      const s2 = await com.login(user);

      const data = await com.getUserData(s2);
      expect(data).toEqual({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        language: user.language,
        avatar: null,
      });

      await com.deleteAccount(s2, user);
    });

    test('Changing language should work', async () => {
      const user = { ...REGISTERED_USER_1 };

      const s = await com.login(user);

      await com.changeLanguage(s, 'en');

      let data = await com.getUserData(s);
      expect(data).toEqual({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        language: 'en',
        avatar: null,
      });

      await com.changeLanguage(s, 'fi');

      data = await com.getUserData(s);
      expect(data).toEqual({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        language: 'fi',
        avatar: null,
      });

      await com.changeLanguage(s, user.language);
      await com.logout(s);
    });

    test('Changing avatar should work', async () => {
      const user = { ...REGISTERED_USER_1 };

      const s = await com.login(user);

      let data = await com.getUserData(s);
      expect(data).toEqual({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        language: user.language,
        avatar: null,
      });

      const image1 = await com.uploadImage(s, TEST_IMAGE_FILE_1);
      const { avatar: avatar1 } = await com.changeAvatar(s, image1);
      await com.deleteImage(s, image1);

      data = await com.getUserData(s);
      expect(data.avatar).not.toBe(null);

      await com.compareImageToFile(avatar1, TEST_IMAGE_FILE_1);

      let url = await com.getImageURL(s, data.avatar);
      await com.compareImageToFile(url, TEST_IMAGE_FILE_1);

      const image2 = await com.uploadImage(s, TEST_IMAGE_FILE_1);
      const { avatar: avatar2 } = await com.changeAvatar(s, image2);
      await com.deleteImage(s, image2);

      data = await com.getUserData(s);
      expect(data.avatar).not.toBe(null);
      expect(data.avatar).not.toEqual(avatar1);

      await com.compareImageToFile(avatar2, TEST_IMAGE_FILE_2);

      url = await com.getImageURL(s, data.avatar);
      await com.compareImageToFile(url, TEST_IMAGE_FILE_2);

      const { avatar: avatar3 } = await com.changeAvatar(s, { id: null });
      expect(avatar3).toBe(null);

      data = await com.getUserData(s);
      expect(data).toEqual({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        language: user.language,
        avatar: null,
      });

      await com.logout(s);
    });
  });

  /* ------------------------------------------------------------------
  Sending and receiving postcards
  */

  describe('Users', () => {
    const users = [REGISTERED_USER_1, REGISTERED_USER_2];
    let session;

    beforeAll(async () => {
      session = await com.login(REGISTERED_USER_1);
    });

    afterAll(async () => {
      await com.logout(session);
    });

    test('Find users should work', async () => {
      for (let i = 0; i < users.length; i += 1) {
        const u = await com.findUser(session, users[i].email);
        expect(u).toBeDefined();
        expect(u).toMatchObject({
          id: expect.anything(),
          firstName: users[i].firstName,
          lastName: users[i].lastName,
          email: users[i].email,
          avatar: null,
        });
      }
    });

    test('Get batch users should work', async () => {
      const map = {};

      for (let i = 0; i < users.length; i += 1) {
        const u = await com.findUser(session, users[i].email);
        map[u.id] = u;
      }

      const ids = [...Object.keys(map)];
      const batch = await com.batchUsers(session, ids);
      expect(batch).toHaveLength(users.length);

      for (let i = 0; i < batch.length; i += 1) {
        const { id } = batch[i];
        expect(batch[i]).toEqual(map[id]);
      }
    });
  });

  /* ------------------------------------------------------------------
  Postcards
  */

  describe('Postcards', () => {
    const users = [REGISTERED_USER_1, REGISTERED_USER_2];
    const sender = users[0];
    const receiver = users[1];
    let senderSession;
    let receiverSession;
    let senderUser;
    let receiverUser;
    let image;

    beforeAll(async () => {
      senderSession = await com.login(sender);
      receiverSession = await com.login(receiver);
      senderUser = await com.findUser(senderSession, sender.email);
      receiverUser = await com.findUser(senderSession, receiver.email);
      image = await com.uploadImage(senderSession, TEST_IMAGE_FILE_1);
    });

    afterAll(async () => {
      await com.deleteImage(senderSession, image);
      await com.logout(senderSession);
      await com.logout(receiverSession);
    });

    test('Sending postcards should work; inbox, sent, and read', async () => {
      const postcard = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );
      expect(postcard).toBeDefined();

      const [received, ...rest1] = await com.getInbox(receiverSession, {});
      expect(received).toBeDefined();
      expect(rest1).toEqual([]);
      expect(parseInt(received.index, 10)).toBeGreaterThanOrEqual(0);
      expect(received.postcard).toBeDefined();

      const [r, ...rest2] = await com.batchPostcards(receiverSession, [
        received.postcard,
      ]);
      expect(r).toBeDefined();
      expect(rest2).toEqual([]);
      expect(r.id).toEqual(received.postcard);
      expect(r.sender).toEqual(senderUser.id);
      expect(r.receiver).toEqual(receiverUser.id);
      expect(r.message).toEqual(postcard.message);
      expect(r.location).toEqual(postcard.location);
      expect(r.created).toBeDefined();
      expect(r.read).toBe(null);

      const [sent, ...rest3] = await com.getSent(senderSession, {});
      expect(sent).toBeDefined();
      expect(rest3).toEqual([]);
      expect(parseInt(sent.index, 10)).toBeGreaterThanOrEqual(0);
      expect(sent.postcard).toBeDefined();

      expect(received.postcard).toEqual(sent.postcard);

      const [s, ...rest4] = await com.batchPostcards(senderSession, [
        sent.postcard,
      ]);
      expect(s).toBeDefined();
      expect(rest4).toEqual([]);
      expect(s.id).toEqual(sent.postcard);
      expect(s.sender).toEqual(senderUser.id);
      expect(s.receiver).toEqual(receiverUser.id);
      expect(s.message).toEqual(postcard.message);
      expect(s.location).toEqual(postcard.location);
      expect(s.created).toBeDefined();
      expect(s.read).toBe(null);

      await com.setAsRead(receiverSession, r);

      const [p] = await com.batchPostcards(senderSession, [sent.postcard]);
      expect(p.read).not.toBe(null);

      const [br, ...rest5] = await com.batchReadStatuses(senderSession, [
        sent.postcard,
      ]);
      expect(br).toBeDefined();
      expect(rest5).toEqual([]);
      expect(br.read).not.toBe(null);

      await com.removeFromInbox(receiverSession, received);
      expect(await com.getInbox(receiverSession, {})).toEqual([]);

      await com.removeFromSent(senderSession, sent);
      expect(await com.getSent(senderSession, {})).toEqual([]);
    });

    test('Connecting users should work', async () => {
      const postcard1 = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );
      expect(postcard1).toBeDefined();

      const [received] = await com.getInbox(receiverSession, {});
      const [sent] = await com.getSent(senderSession, {});
      expect(received).toBeDefined();
      expect(received.postcard).toBeDefined();
      expect(sent).toBeDefined();
      expect(sent.postcard).toBeDefined();

      let friends = await com.getFriends(senderSession, {});
      expect(friends).toEqual([]);

      friends = await com.getFriends(receiverSession, {});
      expect(friends).toEqual([]);

      await com.connectToSender(receiverSession, { id: received.postcard });

      friends = await com.getFriends(senderSession, {});
      expect(friends).toHaveLength(1);
      let [f] = friends;
      expect(f).toEqual({ ...receiverUser, index: f.index });

      await com.unfriend(senderSession, receiverUser);
      expect(await com.getFriends(senderSession, {})).toEqual([]);

      friends = await com.getFriends(receiverSession, {});
      expect(friends).toHaveLength(1);
      [f] = friends;
      expect(f).toEqual({ ...senderUser, index: f.index });

      await com.unfriend(receiverSession, senderUser);
      expect(await com.getFriends(receiverSession, {})).toEqual([]);

      await com.removeFromInbox(receiverSession, received);
      await com.removeFromSent(senderSession, sent);

      expect(await com.getInbox(receiverSession, {})).toEqual([]);
      expect(await com.getSent(senderSession, {})).toEqual([]);
    });

    test('Blocking user should work', async () => {
      const postcard1 = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );
      expect(postcard1).toBeDefined();

      let [received] = await com.getInbox(receiverSession, {});
      let [sent] = await com.getSent(senderSession, {});
      expect(received).toBeDefined();
      expect(received.postcard).toBeDefined();
      expect(sent).toBeDefined();
      expect(sent.postcard).toBeDefined();

      await com.removeFromInbox(receiverSession, received);
      await com.removeFromSent(senderSession, sent);

      await com.block(receiverSession, senderUser);

      const postcard2 = com.randomPostcard(receiverUser, image);
      await com.createPostcard(senderSession, postcard2, 403, {
        error: 'Blocked',
      });
      expect(await com.getInbox(receiverSession, {})).toEqual([]);
      expect(await com.getSent(senderSession, {})).toEqual([]);

      await com.unblock(receiverSession, senderUser);

      const postcard3 = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );
      expect(postcard3).toBeDefined();

      [received] = await com.getInbox(receiverSession, {});
      [sent] = await com.getSent(senderSession, {});
      expect(received).toBeDefined();
      expect(sent).toBeDefined();

      await com.removeFromInbox(receiverSession, received);
      await com.removeFromSent(senderSession, sent);

      expect(await com.getInbox(receiverSession, {})).toEqual([]);
      expect(await com.getSent(senderSession, {})).toEqual([]);
    });
  });

  describe('Endpoints', () => {
    const users = [REGISTERED_USER_1, REGISTERED_USER_2];
    const sender = users[0];
    const receiver = users[1];
    let senderSession;
    let receiverSession;
    let receiverUser;
    let image;

    beforeAll(async () => {
      senderSession = await com.login(sender);
      receiverSession = await com.login(receiver);
      receiverUser = await com.findUser(senderSession, receiver.email);
      image = await com.uploadImage(senderSession, TEST_IMAGE_FILE_1);
    });

    afterAll(async () => {
      await com.deleteImage(senderSession, image);

      const received = await com.getInbox(receiverSession, {});
      const sent = await com.getSent(senderSession, {});
      expect(received.length).toEqual(sent.length);

      for (let i = 0; i < received.length; i += 1) {
        await com.removeFromInbox(receiverSession, received[i]);
        await com.removeFromSent(senderSession, sent[i]);
      }

      expect(await com.getInbox(receiverSession, {})).toEqual([]);
      expect(await com.getSent(senderSession, {})).toEqual([]);

      await com.logout(senderSession);
      await com.logout(receiverSession);
    });

    test('It should notify received postcard', async () => {
      const [ep] = await com.createEndpoints([receiverSession]);
      const [ws] = await com.connectToEndpoints([ep]);
      const [mb] = com.bufferMessages([ws]);

      const postcard = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );

      const m = await com.waitForBuffer(mb);
      expect(m[0]).toEqual({ type: 'postcard-received', id: postcard.id });

      ws.close();
    });

    test('It should notify delivered postcard', async () => {
      const [ep] = await com.createEndpoints([senderSession]);
      const [ws] = await com.connectToEndpoints([ep]);
      const [mb] = com.bufferMessages([ws]);

      const postcard = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );

      await com.setAsRead(receiverSession, postcard);

      const m = await com.waitForBuffer(mb);
      expect(m[0]).toEqual({ type: 'postcard-delivered', id: postcard.id });

      ws.close();
    });

    test('It should notify when set as friend', async () => {
      const [ep] = await com.createEndpoints([senderSession]);
      const [ws] = await com.connectToEndpoints([ep]);
      const [mb] = com.bufferMessages([ws]);

      const postcard = await com.sendRandomPostcard(
        senderSession,
        receiverUser,
        image
      );
      await com.connectToSender(receiverSession, postcard);

      const m = await com.waitForBuffer(mb);
      expect(m[0]).toEqual({ type: 'set-as-friend', id: receiverUser.id });

      ws.close();
    });
  });
});
