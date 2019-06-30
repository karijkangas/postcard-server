/*
 *
 */
Error.stackTraceLimit = Infinity;
jest.setTimeout(30 * 1000);

const com = require('./apitest-common');

com.initialize({
  ADDRESS: 'http://localhost:4000/v1',
  ENDPOINT_ADDRESS: 'ws://localhost:4000/v1/endpoints',
});

const TEST_IMAGE_FILE_1 = {
  name: 'apitest/test-image1.png',
  contentType: 'image/png',
};

const TEST_IMAGE_FILE_2 = {
  name: 'apitest/test-image2.png',
  contentType: 'image/png',
};

beforeAll(async () => {
  await com.devRESET();
});

/* ------------------------------------------------------------------
Check service availability
*/

describe('Test GET /healthz', () => {
  const req = com.request();

  test('It should return 204 with an empty body', async () => {
    const r = await req.get('/healthz').expect(204);
    expect(r.body).toEqual({});
  });
});

/* ------------------------------------------------------------------
Register user
*/

describe('Test GET /registrations/available', () => {
  test('It should accept a valid email', async () => {
    const email = com.randomEmail();
    const r = await com.checkAvailability({ email });
    expect(r).toEqual({ email: true });
  });

  test('It should reject an invalid email', async () => {
    const invalidEmails = [
      undefined,
      {},
      { foo: 'bar' },
      { email: '' },
      { email: 123 },
      { email: 'hello world!' },
    ];
    for (let i = 0; i < invalidEmails.length; i += 1) {
      await com.checkAvailability({ email: invalidEmails[i] }, 400, {
        error: 'Invalid data',
      });
    }
  });

  test('It should reject an existing email', async () => {
    const user = await com.devCreateUser();
    const r = await com.checkAvailability({ email: user.email });
    expect(r).toEqual({ email: false });
    await com.devDeleteUser(user);
  });

  test('It should accept an invited user email', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const u = await com.devCreateUser();
    const s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const user = com.randomUser();
    const i = await com.invite(s, user.email);
    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetInvites()).toHaveLength(1);
    await com.logout(s);
    await com.devDeleteUser(u);

    const invited = await com.devGetUsers();
    expect(invited).toHaveLength(1);
    expect(invited[0].id).toEqual(i.id);
    expect(invited[0].email).toEqual(user.email);

    expect(await com.devGetInvites()).toHaveLength(1);

    const r = await com.checkAvailability({ email: user.email });
    expect(r).toEqual({ email: true });

    await com.devClearInvites();
    expect(await com.devGetInvites()).toHaveLength(0);

    await com.devDeleteUser(i);
    expect(await com.devGetUsers()).toHaveLength(0);
  });
});

describe('Test POST /registrations', () => {
  test('It should accept valid user data', async () => {
    const user = com.randomUser();
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);
    await com.requestRegistration(user);

    const pending = await com.devGetRegistrationRequests();
    expect(pending).toHaveLength(1);

    const a = await com.completeRegistrationRequest(pending[0]);
    expect(a).toBeDefined();
    expect(a.firstName).toEqual(user.firstName);
    expect(a.lastName).toEqual(user.lastName);
    expect(a.email).toEqual(user.email);

    const users = await com.devGetUsers();
    expect(users).toHaveLength(1);
    expect(users[0].email).toEqual(user.email);
    expect(users[0].firstName).toEqual(user.firstName);
    expect(users[0].lastName).toEqual(user.lastName);
    expect(users[0].language).toEqual(user.language);

    const b = await com.devFindUser(user.email);
    const s = await com.login(user);
    await com.logout(s);
    await com.devDeleteUser(b);
  });

  test('It should reject invalid user data', async () => {
    const user = com.randomUser();
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    const invalidUserData = [
      {},
      com.objectWithoutKey(user, 'firstName'),
      { ...user, firstName: '' },
      com.objectWithoutKey(user, 'lastName'),
      { ...user, lastName: '' },
      com.objectWithoutKey(user, 'email'),
      { ...user, email: '' },
      { ...user, email: 'foobar' },
      com.objectWithoutKey(user, 'password'),
      { ...user, password: '' },
      { ...user, password: 'short' },
      com.objectWithoutKey(user, 'language'),
      { ...user, language: 'foobar' },
    ];
    for (let i = 0; i < invalidUserData.length; i += 1) {
      const r = await com.requestRegistration(invalidUserData[i], 400, {
        error: 'Invalid data',
      });
      expect(r).not.toBeDefined();
    }
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject user data matching an existing user', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const u = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(1);
    await com.requestRegistration(u, 409, {
      error: 'User already exists',
    });
    expect(await com.devGetUsers()).toHaveLength(1);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);
  });
});

describe('Test POST /registrations/{id}', () => {
  const user = com.randomUser();

  test('It should complete a valid request', async () => {
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);
    await com.requestRegistration(user);

    const pending = await com.devGetRegistrationRequests();
    expect(pending).toHaveLength(1);
    expect(await com.devGetUsers()).toHaveLength(0);

    const a = await com.completeRegistrationRequest(pending[0]);
    expect(a).toBeDefined();
    expect(a.firstName).toBe(user.firstName);
    expect(a.lastName).toBe(user.lastName);
    expect(a.email).toBe(user.email);

    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    await com.completeRegistrationRequest(pending[0], 404, {
      error: 'Not found',
    });
    const b = await com.devFindUser(user.email);
    expect(b).toBeDefined();
    const s = await com.login(user);
    await com.logout(s);
    await com.devDeleteUser(b);

    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject an invalid request', async () => {
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    const invalidRegistrations = [
      undefined,
      '1',
      'foobar',
      com.randomId(),
      com.randomId(),
    ];
    for (let i = 0; i < invalidRegistrations.length; i += 1) {
      await com.completeRegistrationRequest(invalidRegistrations[i], 404, {
        error: 'Not found',
      });
    }
  });

  test('It should reject registering the same user twice', async () => {
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);

    await com.requestRegistration(user);
    await com.requestRegistration(user);

    const pending = await com.devGetRegistrationRequests();
    expect(pending).toHaveLength(2);

    const a = await com.completeRegistrationRequest(pending[0]);
    expect(a.firstName).toBe(user.firstName);
    expect(a.lastName).toBe(user.lastName);
    expect(a.email).toBe(user.email);
    expect(await com.devGetUsers()).toHaveLength(1);

    await com.completeRegistrationRequest(pending[1], 409, {
      error: 'User already exists',
    });
    expect(await com.devGetUsers()).toHaveLength(1);

    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    const c = await com.devFindUser(user.email);
    expect(c).toBeDefined();
    const s = await com.login(user);
    await com.logout(s);
    await com.devDeleteUser(c);

    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should remove invitation', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const u = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(1);
    const s = await com.login(u);
    expect(await com.devGetInvites()).toHaveLength(0);
    const i = await com.invite(s, user.email);
    expect(await com.devGetUsers()).toHaveLength(2);
    await com.logout(s);
    await com.devDeleteUser(u);
    expect(await com.devGetInvites()).toHaveLength(1);
    expect(await com.devGetUsers()).toHaveLength(1);

    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    const r = await com.requestRegistration(user);
    expect(r).toBeDefined();
    const pending = await com.devGetRegistrationRequests();
    expect(pending).toHaveLength(1);

    const a = await com.completeRegistrationRequest(pending[0]);
    expect(a).toBeDefined();
    expect(a.firstName).toEqual(user.firstName);
    expect(a.lastName).toEqual(user.lastName);
    expect(a.email).toEqual(user.email);

    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const b = await com.devFindUser(user.email);
    expect(b.id).toEqual(i.id);
    const ss = await com.login(user);
    await com.logout(ss);
    await com.devDeleteUser(b);

    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should remove an email from the Do-Not-Disturb list', async () => {
    expect(await com.devGetRegistrationRequests()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);

    await com.requestRegistration(user);
    let pending = await com.devGetRegistrationRequests();
    await com.completeRegistrationRequest(pending[0]);

    const s1 = await com.login(user);

    const invitee = com.randomUser();
    await com.devIgnore(invitee.email);
    expect(await com.devGetIgnored()).toHaveLength(1);

    await com.invite(s1, invitee.email, 409, { error: 'Do not disturb' });
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    await com.logout(s1);

    await com.requestRegistration(invitee);
    pending = await com.devGetRegistrationRequests();
    await com.completeRegistrationRequest(pending[0]);

    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetIgnored()).toHaveLength(0);

    const s2 = await com.login(invitee);
    await com.logout(s2);

    await com.devClearUsers();
    expect(await com.devGetUsers()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Reset password
*/

describe('Test POST /password_resets', () => {
  test('It should accept a valid email', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const user = await com.devCreateUser();
    let s = await com.login(user);
    await com.logout(s);

    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    await com.requestPasswordReset(user.email);

    const pending = await com.devGetPasswordResetRequests();
    expect(pending).toHaveLength(1);

    const newPassword = com.randomPassword();
    const r = await com.completePasswordResetRequest(pending[0], newPassword);
    expect(r).toBeDefined();
    expect(r.firstName).toEqual(user.firstName);
    expect(r.lastName).toEqual(user.lastName);
    expect(r.email).toEqual(user.email);

    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    await com.completePasswordResetRequest(pending[0], newPassword, 404, {
      error: 'Not found',
    });

    s = await com.login({ email: user.email, password: newPassword });
    await com.logout(s);
    await com.devDeleteUser(user);

    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject an invalid email', async () => {
    const invalidEmails = [undefined, 123, 'foo'];
    for (let i = 0; i < invalidEmails.length; i += 1) {
      await com.requestPasswordReset(invalidEmails[i], 400, {
        error: 'Invalid data',
      });
    }
  });

  test('It should reject a missing user', async () => {
    await com.requestPasswordReset(com.randomEmail(), 404, {
      error: 'Not found',
    });
  });

  test('It should reject an invited user', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const u = await com.devCreateUser();
    const s = await com.login(u);
    const user = com.randomUser();
    expect(await com.devGetInvites()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(1);
    await com.invite(s, user.email);
    expect(await com.devGetUsers()).toHaveLength(2);
    await com.logout(s);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(1);

    const pending = await com.devGetInvites();
    expect(pending).toHaveLength(1);
    const a = await com.devFindUser(user.email);
    expect(a.passhash).toBe(null);

    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    await com.requestPasswordReset(user.email, 404, {
      error: 'Not found',
    });
    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    const b = await com.devFindUser(user.email);
    expect(b.passhash).toBe(null);
    await com.devDeleteUser(b);
    expect(await com.devGetUsers()).toHaveLength(0);
  });
});

describe('Test POST /password_resets/{id}', () => {
  let user;
  beforeAll(async () => {
    user = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(1);
  });
  afterAll(async () => {
    await com.devDeleteUser(user);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should complete a valid request', async () => {
    let s = await com.login(user);
    await com.logout(s);

    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    await com.requestPasswordReset(user.email);

    const pending = await com.devGetPasswordResetRequests();
    expect(pending).toHaveLength(1);

    const newPassword = com.randomPassword();
    const r = await com.completePasswordResetRequest(pending[0], newPassword);
    expect(r).toBeDefined();
    expect(r.firstName).toEqual(user.firstName);
    expect(r.lastName).toEqual(user.lastName);
    expect(r.email).toEqual(user.email);

    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    await com.completePasswordResetRequest(pending[0], newPassword, 404, {
      error: 'Not found',
    });

    s = await com.login({ email: user.email, password: newPassword });
    await com.logout(s);
  });

  test('It should reject an invalid request', async () => {
    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    const invalidRequests = [
      undefined,
      123,
      'foo',
      com.randomId(),
      com.randomId(),
    ];
    const newPassword = com.randomPassword();
    for (let i = 0; i < invalidRequests.length; i += 1) {
      await com.completePasswordResetRequest(
        invalidRequests[i],
        newPassword,
        404,
        {
          error: 'Not found',
        }
      );
    }
  });

  test('It should reject an invalid new password', async () => {
    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
    await com.requestPasswordReset(user.email);

    const pending = await com.devGetPasswordResetRequests();
    expect(pending).toHaveLength(1);
    const invalidPasswords = [undefined, '', 'short', 123, { foo: 'bar' }];
    for (let i = 0; i < invalidPasswords.length; i += 1) {
      await com.completePasswordResetRequest(
        pending[0],
        invalidPasswords[i],
        400,
        {
          error: 'Invalid data',
        }
      );
    }
    expect(await com.devGetPasswordResetRequests()).toHaveLength(1);
    await com.devClearRequests();
    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
  });

  test('It should handle the removed user special case', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    const u = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);

    await com.requestPasswordReset(u.email);

    const pending = await com.devGetPasswordResetRequests();
    expect(pending).toHaveLength(1);

    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(1);

    const newPassword = com.randomPassword();
    await com.completePasswordResetRequest(pending[0], newPassword, 409, {
      error: 'User not found',
    });
    expect(await com.devGetPasswordResetRequests()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Login user
*/

describe('Test POST /me/login', () => {
  let user;
  beforeAll(async () => {
    user = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(1);
  });
  afterAll(async () => {
    await com.devDeleteUser(user);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should allow login with a correct email and password', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const s = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(s);
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should reject login with an incorrect email', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const s = await com.login(
      { email: 'foobar', password: user.password },
      400,
      {
        error: 'Invalid data',
      }
    );
    expect(s).not.toBeDefined();
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should reject login with an incorrect password', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const s = await com.login({ email: user.email, password: 'foobar' }, 400, {
      error: 'Invalid data',
    });
    expect(s).not.toBeDefined();
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should create a new session when login again', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const s1 = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.sleep(10);
    const s2 = await com.login(user);
    expect(s2.token).not.toEqual(s1.token);
    expect(s2.expires).toBeGreaterThan(s1.expires);
    expect(await com.devGetSessions()).toHaveLength(2);
    await com.logout(s1);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(s2);
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should reject login an unfinished invited user', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(0);

    const u = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(2);

    const s = await com.login(u);
    expect(await com.devGetSessions()).toHaveLength(1);

    const a = com.randomUser();
    expect(await com.devGetInvites()).toHaveLength(0);

    const invited = await com.invite(s, a.email);
    expect(invited.id).toBeDefined();
    expect(await com.devGetUsers()).toHaveLength(3);
    expect(await com.devGetInvites()).toHaveLength(1);

    await com.login(a, 400, { error: 'Invalid data' });
    expect(await com.devGetSessions()).toHaveLength(1);

    await com.devClearInvites();
    expect(await com.devGetInvites()).toHaveLength(0);

    await com.devDeleteUser(invited);
    await com.logout(s);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(0);
  });
});

describe('Test POST /me/renew', () => {
  let user;
  beforeAll(async () => {
    user = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(1);
  });
  afterAll(async () => {
    await com.devDeleteUser(user);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should renew a valid session', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const s1 = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.sleep(10);
    const s2 = await com.renewSession(s1);
    expect(s2.token).toEqual(s1.token);
    expect(s2.expires).toBeGreaterThan(s1.expires);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(s2);
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should reject a logged out session', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const s1 = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(s1);
    expect(await com.devGetSessions()).toHaveLength(0);

    const s2 = await com.renewSession(s1, 403, { error: 'Invalid session' });
    expect(s2).not.toBeDefined();
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should reject an invalid session', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const session = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    com.testInvalidSessionsWith(async s => {
      return com.renewSession(s, 403, {
        error: 'Invalid session',
      });
    });
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(session);
    expect(await com.devGetSessions()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Logout user
*/

describe('Test POST /me/logout', () => {
  let user;
  beforeAll(async () => {
    user = await com.devCreateUser();
    expect(await com.devGetUsers()).toHaveLength(1);
  });
  afterAll(async () => {
    await com.devDeleteUser(user);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should logout a valid session', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const session = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(session);
    expect(await com.devGetSessions()).toHaveLength(0);
    await com.logout(session, 403, { error: 'Invalid session' });
  });

  test('It should reject an invalid session', async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    const session = await com.login(user);
    expect(await com.devGetSessions()).toHaveLength(1);
    com.testInvalidSessionsWith(async s => {
      return com.logout(s, 403, {
        error: 'Invalid session',
      });
    });
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(session);
    expect(await com.devGetSessions()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Remove user account
*/

describe('Test DELETE /me', () => {
  test('It should accept a valid password', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const Session = await com.createSession();
    const { user, session } = Session;
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devFindUser(user.email)).toBeDefined();
    expect(await com.devGetSessions()).toHaveLength(1);

    await com.deleteAccount(session, user);

    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devFindUser(user.email)).not.toBeDefined();
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should reject an invalid password', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const Session = await com.createSession();
    const { user, session } = Session;
    expect(await com.devGetUsers()).toHaveLength(1);

    await com.deleteAccount(session, { password: com.randomPassword() }, 403, {
      error: 'Invalid password',
    });

    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devFindUser(user.email)).toBeDefined();
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.deleteSession(Session);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should handle the removed user special case', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    const Session = await com.createSession();
    const { user, session } = Session;
    expect(await com.devGetUsers()).toHaveLength(1);

    await com.devDeleteUser(user);
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(1);

    await com.deleteAccount(session, { password: com.randomPassword() }, 409, {
      error: 'User not found',
    });
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should remove the user avatar', async () => {
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const Session = await com.createSession();
    const { user, session } = Session;
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);

    const d1 = await com.getUserData(session);
    expect(d1.email).toEqual(user.email);
    expect(d1.avatar).toBe(null);

    const image = await com.uploadImage(session, TEST_IMAGE_FILE_1);
    expect(await com.devGetUploads()).toHaveLength(1);

    const { avatar } = await com.changeAvatar(session, image);
    const d2 = await com.getUserData(session);
    expect(d2.avatar).not.toBe(null);

    await com.compareImageToFile(avatar, TEST_IMAGE_FILE_1);

    const images = await com.devGetImages();
    expect(images).toHaveLength(1);
    expect(images[0]).toBe(d2.avatar);
    expect(await com.devGetImages()).toHaveLength(1);

    await com.deleteImage(session, image);
    expect(await com.devGetUploads()).toHaveLength(0);

    await com.deleteAccount(session, user);

    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Current user
*/

describe('Test /me', () => {
  let SES;
  let user;
  let session;

  beforeAll(async () => {
    expect(await com.devGetSessions()).toHaveLength(0);
    SES = await com.createSession();
    ({ user, session } = SES);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
  });
  afterAll(async () => {
    await com.deleteSession(SES);
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
  });

  /* ------------------------------------------------------------------
Get current user data
*/

  describe('Test GET /me', () => {
    test('It should return valid user data', async () => {
      const d = await com.getUserData(session);
      expect(d.firstName).toEqual(user.firstName);
      expect(d.lastName).toEqual(user.lastName);
      expect(d.email).toEqual(user.email);
      expect(d.language).toEqual(user.language);
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.getUserData(s, 403, {
          error: 'Invalid session',
        });
      });
    });

    test('It should reject an expired session', async () => {
      expect(await com.devGetSessions()).toHaveLength(1);
      const u = await com.devCreateUser();
      const s = await com.login(u);
      expect(await com.devGetSessions()).toHaveLength(2);
      await com.logout(s);
      expect(await com.devGetSessions()).toHaveLength(1);
      await com.getUserData(s, 403, { error: 'Invalid session' });
      await com.devDeleteUser(u);
    });

    test('It should handle the removed user special case', async () => {
      expect(await com.devGetSessions()).toHaveLength(1);
      const u = await com.devCreateUser();
      const s = await com.login(u);
      await com.devDeleteUser(u);
      expect(await com.devGetSessions()).toHaveLength(2);
      await com.getUserData(s, 409, { error: 'User not found' });
      expect(await com.devGetSessions()).toHaveLength(1);
      await com.devDeleteUser(u);
    });
  });

  /* ------------------------------------------------------------------
Change current user password
*/

  describe('Test PUT /me/password', () => {
    test('It should change password', async () => {
      expect(await com.devGetSessions()).toHaveLength(1);
      const u = await com.devCreateUser();
      let s = await com.login(u);
      expect(await com.devGetSessions()).toHaveLength(2);
      const newPassword = com.randomPassword();
      const r = await com.changePassword(s, {
        password: u.password,
        newPassword,
      });
      expect(r).toBeDefined();
      u.password = newPassword;
      await com.logout(s);
      expect(await com.devGetSessions()).toHaveLength(1);
      s = await com.login(u);
      expect(await com.devGetSessions()).toHaveLength(2);
      await com.logout(s);
      expect(await com.devGetSessions()).toHaveLength(1);
      await com.devDeleteUser(u);
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.changePassword(
          s,
          { password: user.password, newPassword: com.randomPassword() },
          403,
          {
            error: 'Invalid session',
          }
        );
      });
    });

    test('It should reject an invalid new password', async () => {
      const invalidPasswords = ['short'];
      for (let i = 0; i < invalidPasswords.length; i += 1) {
        await com.changePassword(
          session,
          {
            password: user.password,
            newPassword: invalidPasswords[i],
          },
          400,
          { error: 'Invalid data' }
        );
      }
    });

    test('It should reject an invalid password', async () => {
      await com.changePassword(
        session,
        {
          password: com.randomPassword(),
          newPassword: com.randomPassword(),
        },
        403,
        { error: 'Invalid password' }
      );
    });

    test('It should handle the removed user special case', async () => {
      expect(await com.devGetSessions()).toHaveLength(1);
      const u = await com.devCreateUser();
      const s = await com.login(u);
      await com.devDeleteUser(u);
      expect(await com.devGetSessions()).toHaveLength(2);
      const newPassword = com.randomPassword();
      await com.changePassword(
        s,
        {
          password: u.password,
          newPassword,
        },
        409,
        { error: 'User not found' }
      );
      expect(await com.devGetSessions()).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------------
Set current user language
*/

  describe('Test PUT /me/language', () => {
    test('It should change language', async () => {
      expect(user.language).toEqual('en');
      let d = await com.getUserData(session);
      expect(d.language).toEqual('en');
      const language = 'fi';
      const r = await com.changeLanguage(session, language);
      expect(r).toBeDefined();
      d = await com.getUserData(session);
      expect(d.language).toEqual(language);
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.changeLanguage(s, 'fi', 403, {
          error: 'Invalid session',
        });
      });
    });

    test('It should reject an invalid language', async () => {
      const language = 'foobar';
      const r = await com.changeLanguage(session, language, 400, {
        error: 'Invalid data',
      });
      expect(r).not.toBeDefined();
    });

    test('It should handle the removed user special case', async () => {
      expect(await com.devGetSessions()).toHaveLength(1);
      const u = await com.devCreateUser();
      const s = await com.login(u);
      await com.devDeleteUser(u);
      expect(await com.devGetSessions()).toHaveLength(2);
      const language = 'fi';
      await com.changeLanguage(s, language, 409, {
        error: 'User not found',
      });
      expect(await com.devGetSessions()).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------------
Set current user avatar
*/

  describe('Test PUT /me/avatar', () => {
    let image1;
    let image2;

    beforeAll(async () => {
      image1 = await com.uploadImage(session, TEST_IMAGE_FILE_1);
      image2 = await com.uploadImage(session, TEST_IMAGE_FILE_2);
      expect(await com.devGetImages()).toHaveLength(0);
      expect(await com.devGetUploads()).toHaveLength(2);
    });
    afterAll(async () => {
      await com.deleteImage(session, image1);
      await com.deleteImage(session, image2);
      expect(await com.devGetImages()).toHaveLength(0);
      expect(await com.devGetUploads()).toHaveLength(0);
    });

    test('It should change avatar', async () => {
      const sessions = (await com.devGetSessions()).length;
      const S = await com.createSession();
      const { user: u, session: s } = S;
      expect(await com.devGetSessions()).toHaveLength(sessions + 1);
      expect(await com.devGetUploads()).toHaveLength(2);
      expect(await com.devGetImages()).toHaveLength(0);
      const d1 = await com.getUserData(s);
      expect(d1.email).toEqual(u.email);
      expect(d1.avatar).toBe(null);

      const { avatar: a1 } = await com.changeAvatar(s, image1);
      const d2 = await com.getUserData(s);
      expect(d2.avatar).not.toBe(null);
      expect(d2.avatar).not.toBe(image1);

      await com.compareImageToFile(a1, TEST_IMAGE_FILE_1);

      let images = await com.devGetImages();
      expect(images).toHaveLength(1);
      expect(images[0]).toBe(d2.avatar);

      const { avatar: a2 } = await com.changeAvatar(s, image2);
      const d3 = await com.getUserData(s);
      expect(d3.avatar).not.toBe(d2.image2);
      expect(d3.avatar).not.toBe(d2.avatar);

      await com.compareImageToFile(a2, TEST_IMAGE_FILE_2);

      images = await com.devGetImages();
      expect(images).toHaveLength(1);
      expect(images[0]).toBe(d3.avatar);

      await com.deleteAccount(s, u);
      expect(await com.devGetSessions()).toHaveLength(sessions);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should clear avatar', async () => {
      const sessions = (await com.devGetSessions()).length;
      const S = await com.createSession();
      const { user: u, session: s } = S;
      expect(await com.devGetSessions()).toHaveLength(sessions + 1);
      expect(await com.devGetUploads()).toHaveLength(2);
      expect(await com.devGetImages()).toHaveLength(0);
      const d1 = await com.getUserData(s);
      expect(d1.email).toEqual(u.email);
      expect(d1.avatar).toBe(null);

      const { avatar: a1 } = await com.changeAvatar(s, { id: null });
      expect(a1).toBe(null);
      const d2 = await com.getUserData(s);
      expect(d2.avatar).toBe(null);
      let images = await com.devGetImages();
      expect(images).toHaveLength(0);

      const { avatar: a2 } = await com.changeAvatar(s, image2);
      const d3 = await com.getUserData(s);
      expect(d3.avatar).not.toBe(d2.image2);
      expect(d3.avatar).not.toBe(d2.avatar);

      await com.compareImageToFile(a2, TEST_IMAGE_FILE_2);

      images = await com.devGetImages();
      expect(images).toHaveLength(1);
      expect(images[0]).toBe(d3.avatar);

      const { avatar: a3 } = await com.changeAvatar(s, { id: '' });
      expect(a3).toEqual(null);
      const d4 = await com.getUserData(s);
      expect(d4.avatar).toBe(null);
      images = await com.devGetImages();
      expect(images).toHaveLength(0);

      await com.deleteAccount(s, u);
      expect(await com.devGetSessions()).toHaveLength(sessions);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.changeAvatar(s, image1, 403, {
          error: 'Invalid session',
        });
      });
    });

    test('It should reject a missing image', async () => {
      const sessions = (await com.devGetSessions()).length;
      const S = await com.createSession();
      const { user: u, session: s } = S;
      expect(await com.devGetSessions()).toHaveLength(sessions + 1);
      expect(await com.devGetImages()).toHaveLength(0);
      const d1 = await com.getUserData(s);
      expect(d1.email).toEqual(u.email);
      expect(d1.avatar).toBe(null);

      const invalidImages = [com.randomFileId(), com.randomFileId()];
      for (let i = 0; i < invalidImages.length; i += 1) {
        await com.changeAvatar(s, { id: invalidImages[i] }, 404, {
          error: 'Not found',
        });
      }

      const d2 = await com.getUserData(s);
      expect(d2.avatar).toBe(null);

      await com.deleteAccount(s, u);
      expect(await com.devGetSessions()).toHaveLength(sessions);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should handle the removed user special case', async () => {
      const sessions = (await com.devGetSessions()).length;
      const u = await com.devCreateUser();
      const s = await com.login(u);
      await com.devDeleteUser(u);
      expect(await com.devGetSessions()).toHaveLength(sessions + 1);
      await com.changeAvatar(s, image1, 409, {
        error: 'User not found',
      });
      expect(await com.devGetSessions()).toHaveLength(sessions);
    });
  });
});

/* ------------------------------------------------------------------
Change current user email
*/

describe('Test PUT /me/email', () => {
  test('It should accept a valid request', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    let s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);

    const newEmail = com.randomEmail();
    expect(newEmail).not.toEqual(u.email);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    const r = await com.requestEmailChange(s, {
      password: u.password,
      newEmail,
    });
    expect(r).toBeDefined();

    const pending = await com.devGetEmailChangeRequests();
    expect(pending).toHaveLength(1);

    const b = await com.completeEmailChangeRequest(pending[0]);
    expect(b).toBeDefined();
    expect(b.firstName).toEqual(u.firstName);
    expect(b.lastName).toEqual(u.lastName);
    expect(b.email).toEqual(newEmail);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    const c = await com.devFindUser(newEmail);
    expect(c.id).toEqual(u.id);
    expect(c.email).toEqual(newEmail);
    expect(c.email).not.toEqual(u.email);

    u.email = newEmail;
    await com.logout(s);

    expect(await com.devGetSessions()).toHaveLength(0);
    s = await com.login(u);

    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(s);
    expect(await com.devGetSessions()).toHaveLength(0);

    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject an invalid email', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    const s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    const invalidEmails = [undefined, 123, '', 'hello world!'];
    for (let i = 0; i < invalidEmails.length; i += 1) {
      await com.requestEmailChange(
        s,
        {
          password: u.password,
          newEmail: invalidEmails[i],
        },
        400,
        { error: 'Invalid data' }
      );
    }
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(1);

    await com.logout(s);
    expect(await com.devGetSessions()).toHaveLength(0);

    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject an invalid password', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    const s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);

    const newEmail = com.randomEmail();
    expect(newEmail).not.toEqual(u.email);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    await com.requestEmailChange(
      s,
      {
        password: com.randomPassword(),
        newEmail,
      },
      403,
      { error: 'Invalid password' }
    );
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    await com.logout(s);
    expect(await com.devGetSessions()).toHaveLength(0);

    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject an invalid session', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    const newEmail = com.randomEmail();
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    com.testInvalidSessionsWith(async s => {
      return com.requestEmailChange(
        s,
        { password: u.password, newEmail },
        403,
        {
          error: 'Invalid session',
        }
      );
    });
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should handle the removed user special case', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    const s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);

    const newEmail = com.randomEmail();
    expect(newEmail).not.toEqual(u.email);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    await com.requestEmailChange(
      s,
      {
        password: u.password,
        newEmail,
      },
      409,
      { error: 'User not found' }
    );
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
  });
});

describe('Test POST /email_changes/{id}', () => {
  test('It should accept a valid request', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    let s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);

    const newEmail = com.randomEmail();
    expect(newEmail).not.toEqual(u.email);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    await com.requestEmailChange(s, {
      password: u.password,
      newEmail,
    });

    const pending = await com.devGetEmailChangeRequests();
    expect(pending).toHaveLength(1);

    const b = await com.completeEmailChangeRequest(pending[0]);
    expect(b).toBeDefined();
    expect(b.firstName).toEqual(u.firstName);
    expect(b.lastName).toEqual(u.lastName);
    expect(b.email).toEqual(newEmail);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);

    const c = await com.devFindUser(newEmail);
    expect(c.id).toEqual(u.id);
    expect(c.email).toEqual(newEmail);
    expect(c.email).not.toEqual(u.email);

    u.email = newEmail;
    await com.logout(s);
    expect(await com.devGetSessions()).toHaveLength(0);
    s = await com.login(u);
    expect(await com.devGetSessions()).toHaveLength(1);
    await com.logout(s);
    expect(await com.devGetSessions()).toHaveLength(0);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should reject an invalid request', async () => {
    const invalidRequests = [
      undefined,
      123,
      'foo',
      com.randomId(),
      com.randomId(),
    ];
    for (let i = 0; i < invalidRequests.length; i += 1) {
      await com.completeEmailChangeRequest(invalidRequests[i], 404, {
        error: 'Not found',
      });
    }
  });

  test('It should handle the removed user special case', async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    const u = await com.devCreateUser();
    const s = await com.login(u);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);

    const newEmail = com.randomEmail();
    expect(newEmail).not.toEqual(u.email);
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    await com.requestEmailChange(s, {
      password: u.password,
      newEmail,
    });
    const pending = await com.devGetEmailChangeRequests();
    expect(pending).toHaveLength(1);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(0);

    await com.completeEmailChangeRequest(pending[0], 409, {
      error: 'User not found',
    });
    expect(await com.devGetEmailChangeRequests()).toHaveLength(0);
    await com.devClearSessions();
    expect(await com.devGetSessions()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Invite user
*/

describe('Test POST /users/invite', () => {
  let Session;
  let user;
  let session;

  beforeAll(async () => {
    Session = await com.createSession();
    ({ user, session } = Session);
    expect(await com.devGetUsers()).toHaveLength(1);
  });
  afterAll(async () => {
    await com.deleteSession(Session);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should accept a valid email', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const email = com.randomEmail();
    const invited = await com.invite(session, email);
    expect(invited.id);
    expect(await com.devGetUsers()).toHaveLength(2);

    const a = await com.devFindUser(email);
    expect(a).toBeDefined();
    expect(a.id).toEqual(invited.id);
    expect(a.email).toEqual(email);
    expect(a.firstName).toBe(null);
    expect(a.lastName).toBe(null);
    expect(a.lastName).toBe(null);
    expect(a.language).toBe(null);
    expect(a.avatar).toBe(null);

    await com.login({ email }, 400, { error: 'Invalid data' });

    const pending = await com.devGetInvites();
    expect(pending).toHaveLength(1);

    const u = com.randomUser({ email });
    const b = await com.completeInvite(pending[0], u);
    expect(b).toBeDefined();
    expect(b.firstName).toEqual(u.firstName);
    expect(b.lastName).toEqual(u.lastName);
    expect(b.email).toEqual(email);
    expect(await com.devGetInvites()).toHaveLength(0);

    const s = await com.login(u);
    const d = await com.getUserData(s);
    expect(d.firstName).toEqual(u.firstName);
    expect(d.lastName).toEqual(u.lastName);
    expect(d.email).toEqual(u.email);
    expect(d.language).toEqual(u.language);
    expect(d.avatar).toBe(null);

    await com.logout(s);
    await com.devDeleteUser(a);

    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should return an existing user without invite', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const invited = await com.invite(session, user.email);
    expect(invited.id).toEqual(user.id);
    expect(await com.devGetInvites()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should reject an invalid email', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);
    const invalidEmails = [undefined, 'foo'];
    for (let i = 0; i < invalidEmails.length; i += 1) {
      await com.invite(session, invalidEmails[i], 400, {
        error: 'Invalid data',
      });
    }
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);
  });

  test('It should reject an invalid session', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    const u = await com.devCreateUser();
    com.testInvalidSessionsWith(async s => {
      return com.invite(s, u, 403, {
        error: 'Invalid session',
      });
    });
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should reject an email in the Do-Not-Disturb list', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const email = com.randomEmail();
    await com.devClearIgnored();
    await com.devIgnore(email);
    await com.invite(session, email, 409, { error: 'Do not disturb' });
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);
    await com.devClearIgnored();
  });

  test('It should reject duplicated invitations', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const email = com.randomEmail();
    const invited = await com.invite(session, email);
    expect(invited.id);
    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetInvites()).toHaveLength(1);

    await com.invite(session, email, 409, { error: 'Already invited' });
    expect(await com.devGetInvites()).toHaveLength(1);

    await com.devClearInvites();
    expect(await com.devGetInvites()).toHaveLength(0);

    await com.devDeleteUser(invited);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should handle the removed user special case', async () => {
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);
    expect(await com.devGetInvites()).toHaveLength(0);

    const S1 = await com.createSession();
    const { user: u1, session: s1 } = S1;

    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetSessions()).toHaveLength(2);
    await com.devDeleteUser(u1);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(2);

    const email = com.randomEmail();
    await com.invite(s1, email, 409, { error: 'User not found' });

    expect(await com.devGetInvites()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(1);
  });
});

describe('Test POST /invites/{id}', () => {
  let Session;
  let user;
  let session;

  beforeAll(async () => {
    Session = await com.createSession();
    ({ user, session } = Session);
    expect(await com.devGetUsers()).toHaveLength(1);
  });
  afterAll(async () => {
    await com.deleteSession(Session);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should complete a valid invite', async () => {
    expect(await com.devGetInvites()).toHaveLength(0);

    expect(await com.devGetUsers()).toHaveLength(1);
    const email = com.randomEmail();
    const u = await com.invite(session, email);
    expect(u.id).toBeDefined();
    expect(await com.devGetUsers()).toHaveLength(2);

    const pending = await com.devGetInvites();
    expect(pending).toHaveLength(1);

    const invited = com.randomUser({ email });
    const b = await com.completeInvite(pending[0], invited);
    expect(b).toBeDefined();
    expect(b.firstName).toEqual(invited.firstName);
    expect(b.lastName).toEqual(invited.lastName);
    expect(b.email).toEqual(email);

    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetInvites()).toHaveLength(0);
    await com.completeInvite(pending[0], invited, 404, {
      error: 'Not found',
    });

    const s = await com.login(invited);
    const d = await com.getUserData(s);
    expect(d.firstName).toEqual(invited.firstName);
    expect(d.lastName).toEqual(invited.lastName);
    expect(d.email).toEqual(invited.email);
    expect(d.language).toEqual(invited.language);
    expect(d.avatar).toBe(null);

    await com.logout(s);
    await com.devDeleteUser(u);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should reject invalid user data', async () => {
    expect(await com.devGetInvites()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(1);
    const email = com.randomEmail();
    const invited = await com.invite(session, email);
    expect(invited.id).toBeDefined();
    expect(await com.devGetUsers()).toHaveLength(2);
    const invalidUsers = [
      {},
      com.objectWithoutKey(user, 'firstName'),
      { ...user, firstName: '' },
      com.objectWithoutKey(user, 'lastName'),
      { ...user, lastName: '' },
      com.objectWithoutKey(user, 'password'),
      { ...user, password: '' },
      { ...user, password: 'short' },
      com.objectWithoutKey(user, 'language'),
      { ...user, language: 'foobar' },
    ];
    for (let i = 0; i < invalidUsers.length; i += 1) {
      await com.completeInvite(invited.id, invalidUsers[i], 400, {
        error: 'Invalid data',
      });
      expect(await com.devGetInvites()).toHaveLength(1);
    }
    await com.devClearInvites();
    expect(await com.devGetInvites()).toHaveLength(0);

    await com.devDeleteUser(invited);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should reject an invalid invite', async () => {
    expect(await com.devGetInvites()).toHaveLength(0);
    const email = com.randomEmail();
    const invited = await com.invite(session, email);
    expect(invited.id).toBeDefined();
    const invalidRequests = [
      undefined,
      123,
      'foo',
      com.randomInviteId(),
      com.randomInviteId(),
    ];
    for (let i = 0; i < invalidRequests.length; i += 1) {
      await com.completeInvite(invalidRequests[i], user, 404, {
        error: 'Not found',
      });
    }
    expect(await com.devGetInvites()).toHaveLength(1);

    await com.devClearInvites();
    expect(await com.devGetInvites()).toHaveLength(0);

    await com.devDeleteUser(invited);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  test('It should handle the removed user special case', async () => {
    const email = com.randomEmail();
    expect(await com.devGetUsers()).toHaveLength(1);
    const invited = await com.invite(session, email);
    expect(invited.id).toBeDefined();
    expect(await com.devGetUsers()).toHaveLength(2);

    const pending = await com.devGetInvites();
    expect(pending).toHaveLength(1);

    await com.devDeleteUser(invited);
    expect(await com.devGetUsers()).toHaveLength(1);

    expect(await com.devGetInvites()).toHaveLength(0);
    const u = com.randomUser({ email });
    await com.completeInvite(pending[0], u, 404, {
      error: 'Not found',
    });
    expect(await com.devGetInvites()).toHaveLength(0);
  });
});

describe('Test DELETE /invites/{id}', () => {
  beforeAll(async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetInvites()).toHaveLength(0);
  });
  afterAll(async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetInvites()).toHaveLength(0);
  });

  test('It should accept a valid invite', async () => {
    expect(await com.devGetInvites()).toHaveLength(0);
    expect(await com.devGetIgnored()).toHaveLength(0);

    const S = await com.createSession();
    const { session } = S;

    expect(await com.devGetUsers()).toHaveLength(1);
    const email = com.randomEmail();
    const u = await com.invite(session, email);
    expect(u.id).toBeDefined();
    expect(await com.devGetUsers()).toHaveLength(2);

    const pending = await com.devGetInvites();
    expect(pending).toHaveLength(1);

    await com.rejectInviteRequest(pending[0]);

    expect(await com.devGetInvites()).toHaveLength(0);
    expect(await com.devGetIgnored()).toHaveLength(1);
    const users = await com.devGetUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).not.toEqual(u.id);

    await com.rejectInviteRequest(pending[0], 404, { error: 'Not found' });

    await com.deleteSession(S);
    expect(await com.devGetUsers()).toHaveLength(0);

    await com.devClearIgnored();
    expect(await com.devGetIgnored()).toHaveLength(0);
  });

  test('It should reject an invalid invite', async () => {
    expect(await com.devGetInvites()).toHaveLength(0);
    const invalidRequests = [
      undefined,
      123,
      'foo',
      com.randomInviteId(),
      com.randomInviteId(),
    ];
    for (let i = 0; i < invalidRequests.length; i += 1) {
      await com.rejectInviteRequest(invalidRequests[i], 404, {
        error: 'Not found',
      });
    }
  });

  test('It should handle the removed user special case', async () => {
    const S = await com.createSession();
    const { session } = S;

    const email = com.randomEmail();
    expect(await com.devGetUsers()).toHaveLength(1);
    const invited = await com.invite(session, email);
    expect(invited.id).toBeDefined();
    expect(await com.devGetUsers()).toHaveLength(2);

    const pending = await com.devGetInvites();
    expect(pending).toHaveLength(1);

    await com.devDeleteUser(invited);
    expect(await com.devGetUsers()).toHaveLength(1);

    expect(await com.devGetInvites()).toHaveLength(0);
    await com.rejectInviteRequest(pending[0], 404, {
      error: 'Not found',
    });

    await com.deleteSession(S);
    expect(await com.devGetUsers()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------
Find user by email
*/

describe('Test GET /users', () => {
  test('It should find an existing user', async () => {
    const S = await com.createSession();
    const { session } = S;
    const u = await com.devCreateUser();
    const users = await com.findUsers(session, u.email);
    expect(users).toHaveLength(1);
    expect(users[0].id).toEqual(u.id);
    expect(users[0].firstName).toEqual(u.firstName);
    expect(users[0].lastName).toEqual(u.lastName);
    expect(users[0].email).toEqual(u.email);
    await com.devDeleteUser(u);
    await com.deleteSession(S);
  });

  test('It should find the current user', async () => {
    const S = await com.createSession();
    const { user, session } = S;
    const users = await com.findUsers(session, user.email);
    expect(users).toHaveLength(1);
    expect(users[0].id).toEqual(user.id);
    expect(users[0].firstName).toEqual(user.firstName);
    expect(users[0].lastName).toEqual(user.lastName);
    expect(users[0].email).toEqual(user.email);
    await com.deleteSession(S);
  });

  test('It should return an empty array when the user is not found', async () => {
    const S = await com.createSession();
    const { session } = S;
    const users = await com.findUsers(session, com.randomEmail());
    expect(users).toHaveLength(0);
    await com.deleteSession(S);
  });

  test('It should reject an invalid email', async () => {
    const S = await com.createSession();
    const { session } = S;
    const invalidEmails = [
      undefined,
      {},
      { foo: 'bar' },
      { email: '' },
      { email: 'hello world!' },
    ];
    for (let i = 0; i < invalidEmails.length; i += 1) {
      await com.findUsers(session, invalidEmails[i], 400, {
        error: 'Invalid data',
      });
    }
    await com.deleteSession(S);
  });

  test('It should reject an invalid session', async () => {
    const email = com.randomEmail();
    com.testInvalidSessionsWith(async s => {
      return com.findUsers(s, email, 403, {
        error: 'Invalid session',
      });
    });
  });
});

/* ------------------------------------------------------------------
Get batch user data
*/

describe('Test GET /users/batch', () => {
  const users = {};
  const numberOfUsers = 10;
  let Session;
  let session;
  let user;

  beforeAll(async () => {
    for (let i = 0; i < numberOfUsers; i += 1) {
      const u = await com.devCreateUser();
      users[u.id] = u;
    }
    Session = await com.createSession();
    ({ user, session } = Session);

    expect(await com.devGetUsers()).toHaveLength(numberOfUsers + 1);
    expect(await com.devGetSessions()).toHaveLength(1);
  });

  afterAll(async () => {
    await com.deleteSession(Session);
    await com.devClearUsers();
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
  });

  test('It should return users', async () => {
    const ids = Object.keys(users);
    expect(com.unique(ids)).toHaveLength(numberOfUsers);

    const uu = await com.batchUsers(session, ids);
    expect(uu).toHaveLength(numberOfUsers);
    uu.forEach(u => {
      expect(u.id).toEqual(users[u.id].id);
      expect(u.firstName).toEqual(users[u.id].firstName);
      expect(u.lastName).toEqual(users[u.id].lastName);
      expect(u.email).toEqual(users[u.id].email);
      expect(u.avatar).toEqual(null);
    });
  });

  test('It should return the current user', async () => {
    const uu = await com.batchUsers(session, [user.id]);
    expect(uu).toHaveLength(1);
    expect(uu[0].id).toEqual(user.id);
    expect(uu[0].firstName).toEqual(user.firstName);
    expect(uu[0].lastName).toEqual(user.lastName);
    expect(uu[0].email).toEqual(user.email);
    expect(uu[0].avatar).toEqual(null);
  });

  test('It should return a subset of users', async () => {
    const ids = Object.keys(users);
    const subset = [ids[1], ids[3], ids[4]];

    const uu = await com.batchUsers(session, subset);
    expect(uu).toHaveLength(subset.length);
    expect(subset.sort()).toEqual(uu.map(u => u.id).sort());
  });

  test('It should ignore duplicated users', async () => {
    const ids = Object.keys(users);
    const subset = [ids[1], ids[4], ids[1], ids[5]];
    const uu = await com.batchUsers(session, subset);

    const uniqueSubset = com.unique(subset);
    expect(uu).toHaveLength(uniqueSubset.length);

    expect(uniqueSubset.sort()).toEqual(uu.map(u => u.id).sort());
  });

  test('It should reject invalid users', async () => {
    const invalidIds = [undefined, 123, 'hello'];
    for (let i = 0; i < invalidIds.length; i += 1) {
      await com.batchUsers(session, invalidIds[i], 400, {
        error: 'Invalid data',
      });
    }
  });

  test('It should ignore missing users', async () => {
    const ids = Object.keys(users);
    expect(await com.batchUsers(session, [com.randomString(4)])).toHaveLength(
      0
    );
    expect(await com.batchUsers(session, [com.randomUserId()])).toHaveLength(0);
    expect(
      await com.batchUsers(session, [ids[0], com.randomUserId()])
    ).toHaveLength(1);
    expect(
      await com.batchUsers(session, [com.randomUserId(), ids[2], ids[3]])
    ).toHaveLength(2);
  });

  test('It should reject an invalid session', async () => {
    const ids = Object.keys(users);
    com.testInvalidSessionsWith(async s => {
      return com.batchUsers(s, ids, 403, {
        error: 'Invalid session',
      });
    });
  });
});

/* ------------------------------------------------------------------
Get friends
*/

describe('Test GET /users/friends', () => {
  const users = [];
  const numberOfUsers = 2 * 10;
  const numberOfFriends = numberOfUsers / 2;
  let Session;
  let session;
  let user;
  let friendIds;

  beforeAll(async () => {
    for (let i = 0; i < numberOfUsers; i += 1) {
      const f = await com.devCreateUser();
      users.push(f);
    }
    Session = await com.createSession();
    ({ user, session } = Session);

    expect(await com.getFriends(session, {})).toHaveLength(0);

    const friends = com.shuffle(users).slice(0, numberOfFriends);
    for (let i = 0; i < friends.length; i += 1) {
      await com.devMakeFriends(user, friends[i]);
    }
    friendIds = com.sortedIds(friends);
  });

  afterAll(async () => {
    await com.devClearFriends();
    expect(await com.getFriends(session, {})).toHaveLength(0);

    await com.devClearUsers();
    await com.devClearSessions();
  });

  test('It should return friends', async () => {
    const ff = await com.getFriends(session, {});
    expect(ff).toHaveLength(friendIds.length);
    expect(com.sortedIds(ff)).toEqual(friendIds);
    const indices = ff.map(u => u.index);
    expect(indices).toEqual(
      indices.slice().sort((a, b) => parseInt(a, 10) < parseInt(b, 10))
    );
  });

  test('It should support a valid excludeStartIndex', async () => {
    const f1 = await com.getFriends(session, { exclusiveStartIndex: 0 });
    expect(f1).toHaveLength(numberOfFriends);

    const f2 = await com.getFriends(session, {
      exclusiveStartIndex: f1[0].index,
    });
    expect(f2).toHaveLength(numberOfFriends - 1);

    const f3 = await com.getFriends(session, {
      exclusiveStartIndex: f1[4].index,
    });
    expect(f3).toHaveLength(numberOfFriends - 5);

    const f4 = await com.getFriends(session, {
      exclusiveStartIndex: f1[numberOfFriends - 1].index,
    });
    expect(f4).toHaveLength(0);
  });

  test('It should support a valid limit', async () => {
    const f1 = await com.getFriends(session, { exclusiveStartIndex: 0 });
    expect(f1).toHaveLength(numberOfFriends);
    expect(com.sortedIds(f1)).toEqual(friendIds);

    const f2 = await com.getFriends(session, { limit: 1 });
    expect(f2).toHaveLength(1);
    expect(f2[0].id).toEqual(f1[0].id);

    const f3 = await com.getFriends(session, {
      exclusiveStartIndex: f1[0].index,
      limit: 2,
    });
    expect(f3).toHaveLength(2);
    expect(f3[0].id).toEqual(f1[1].id);
    expect(f3[1].id).toEqual(f1[2].id);

    const f4 = await com.getFriends(session, { limit: numberOfFriends });
    expect(f4).toHaveLength(numberOfFriends);

    const f5 = await com.getFriends(session, { limit: numberOfFriends + 1 });
    expect(f5).toHaveLength(numberOfFriends);
  });

  test('It should reject an invalid exclusiveStartIndex', async () => {
    const invalidIndices = ['hello', -1];
    for (let i = 0; i < invalidIndices.length; i += 1) {
      await com.getFriends(
        session,
        { exclusiveStartIndex: invalidIndices[i] },
        400,
        {
          error: 'Invalid data',
        }
      );
    }
  });

  test('It should reject an invalid limit', async () => {
    const invalidLimits = [-1, 0, 'hello', 10000];
    for (let i = 0; i < invalidLimits.length; i += 1) {
      await com.getFriends(session, { limit: invalidLimits[i] }, 400, {
        error: 'Invalid data',
      });
    }
  });

  test('It should reject an invalid session', async () => {
    const email = com.randomEmail();
    com.testInvalidSessionsWith(async s => {
      return com.getFriends(s, email, 403, {
        error: 'Invalid session',
      });
    });
  });
});

/* ------------------------------------------------------------------
Get blocked users
*/

describe('Test GET /users/blocked', () => {
  const users = [];
  const numberOfUsers = 2 * 10;
  const numberOfBlocked = numberOfUsers / 2;
  let Session;
  let session;
  let blockedIds;

  beforeAll(async () => {
    for (let i = 0; i < numberOfUsers; i += 1) {
      const f = await com.devCreateUser();
      users.push(f);
    }
    Session = await com.createSession();
    ({ session } = Session);

    expect(await com.getBlocked(session)).toHaveLength(0);

    const blocked = com.shuffle(users).slice(0, numberOfBlocked);
    for (let i = 0; i < blocked.length; i += 1) {
      await com.block(session, blocked[i]);
    }
    blockedIds = com.sortedIds(blocked);
  });

  afterAll(async () => {
    await com.devClearBlocked();
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.devClearUsers();
    await com.devClearSessions();
  });

  test('It should return blocked users', async () => {
    const ff = await com.getBlocked(session);
    expect(ff).toHaveLength(numberOfBlocked);
    expect(com.sortedIds(ff)).toEqual(blockedIds);
    const indices = ff.map(u => u.index);
    expect(indices).toEqual(
      indices.slice().sort((a, b) => parseInt(a, 10) < parseInt(b, 10))
    );
  });

  test('It should support a valid excludeStartIndex', async () => {
    const f1 = await com.getBlocked(session);
    expect(f1).toHaveLength(numberOfBlocked);
    expect(com.sortedIds(f1)).toEqual(blockedIds);

    const f2 = await com.getBlocked(session, { exclusiveStartIndex: 0 });
    expect(f2).toHaveLength(numberOfBlocked);

    const f3 = await com.getBlocked(session, {
      exclusiveStartIndex: f1[0].index,
    });
    expect(f3).toHaveLength(numberOfBlocked - 1);

    const f4 = await com.getBlocked(session, {
      exclusiveStartIndex: f1[4].index,
    });
    expect(f4).toHaveLength(numberOfBlocked - 5);

    const f5 = await com.getBlocked(session, {
      exclusiveStartIndex: f1[numberOfBlocked - 1].index,
    });
    expect(f5).toHaveLength(0);
  });

  test('It should support a valid limit', async () => {
    const f1 = await com.getBlocked(session);
    expect(f1).toHaveLength(numberOfBlocked);
    expect(com.sortedIds(f1)).toEqual(blockedIds);

    const f2 = await com.getBlocked(session, { limit: 1 });
    expect(f2).toHaveLength(1);

    const f3 = await com.getBlocked(session, {
      exclusiveStartIndex: f1[0].index,
      limit: 2,
    });
    expect(f3).toHaveLength(2);
    expect(f3[0].id).toEqual(f1[1].id);
    expect(f3[1].id).toEqual(f1[2].id);

    const f4 = await com.getBlocked(session, { limit: numberOfBlocked });
    expect(f4).toHaveLength(numberOfBlocked);

    const f5 = await com.getBlocked(session, { limit: numberOfBlocked + 1 });
    expect(f5).toHaveLength(numberOfBlocked);
  });

  test('It should reject an invalid exclusiveStartIndex', async () => {
    const invalidIndices = ['hello', -1];
    for (let i = 0; i < invalidIndices.length; i += 1) {
      await com.getBlocked(
        session,
        { exclusiveStartIndex: invalidIndices[i] },
        400,
        {
          error: 'Invalid data',
        }
      );
    }
  });

  test('It should reject an invalid limit', async () => {
    const invalidLimits = [-1, 0, 'hello', 10000];
    for (let i = 0; i < invalidLimits.length; i += 1) {
      await com.getBlocked(session, { limit: invalidLimits[i] }, 400, {
        error: 'Invalid data',
      });
    }
  });

  test('It should reject an invalid session', async () => {
    const email = com.randomEmail();
    com.testInvalidSessionsWith(async s => {
      return com.getBlocked(s, email, 403, {
        error: 'Invalid session',
      });
    });
  });
});

/* ------------------------------------------------------------------
Block user
*/

describe('Test PUT /users/{id}/blocked', () => {
  let Session;
  let session;

  beforeAll(async () => {
    Session = await com.createSession();
    ({ session } = Session);
  });

  afterAll(async () => {
    await com.devClearUsers();
    await com.devClearSessions();
  });

  test('It should block postcards', async () => {
    const Session1 = await com.createSession();
    const Session2 = await com.createSession();

    const { user: sender, session: s1 } = Session1;
    const { user: receiver, session: s2 } = Session2;

    const image = await com.uploadImage(s1, TEST_IMAGE_FILE_2);

    const postcard1 = com.randomPostcard(receiver, image);
    const p = await com.createPostcard(s1, postcard1);

    let postcards = await com.devGetPostcards();
    let images = await com.devGetImages();
    expect(postcards).toHaveLength(1);
    expect(images).toHaveLength(1);

    expect(postcards[0].id).toEqual(p.id);
    expect(postcards[0].sender).toEqual(sender.id);
    expect(postcards[0].receiver).toEqual(receiver.id);
    expect(postcards[0].image).toEqual(images[0]);
    expect(postcards[0].message).toEqual(postcard1.message);
    expect(postcards[0].location).toEqual(postcard1.location);
    expect(postcards[0].created).toBeDefined();

    await com.block(s2, sender);
    const postcard2 = com.randomPostcard(receiver, image);
    await com.createPostcard(s1, postcard2, 403, { error: 'Blocked' });

    postcards = await com.devGetPostcards();
    images = await com.devGetImages();
    expect(postcards).toHaveLength(1);
    expect(images).toHaveLength(1);

    await com.unblock(s2, sender);
    await com.createPostcard(s1, postcard2);

    postcards = await com.devGetPostcards();
    images = await com.devGetImages();
    expect(postcards).toHaveLength(2);

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);

    await com.deleteImage(s1, image);
    await com.deleteSession(Session1);
    await com.deleteSession(Session2);
    expect(await com.devGetUploads()).toHaveLength(0);
  });

  test('It should block a non-blocked user', async () => {
    const u = await com.devCreateUser();
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.block(session, u);

    const blocked = await com.getBlocked(session);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].id).toEqual(u.id);

    await com.devDeleteUser(u);
    expect(await com.getBlocked(session)).toHaveLength(0);
  });

  test('It should ignore blocking an already blocked user', async () => {
    const u = await com.devCreateUser();
    expect(await com.getBlocked(session)).toHaveLength(0);
    await com.block(session, u);

    const blocked = await com.getBlocked(session);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].id).toEqual(u.id);

    await com.block(session, u);
    expect(await com.getBlocked(session)).toHaveLength(1);

    await com.devDeleteUser(u);
    expect(await com.getBlocked(session)).toHaveLength(0);
  });

  test('It should reject blocking an invalid user', async () => {
    const u = await com.devCreateUser();
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.block(session, { id: com.randomUserId() }, 404, {
      error: 'Not found',
    });
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.devDeleteUser(u);
    expect(await com.getBlocked(session)).toHaveLength(0);
  });

  test('It should unblock a blocked user', async () => {
    const u = await com.devCreateUser();

    expect(await com.getBlocked(session)).toHaveLength(0);
    await com.block(session, u);

    const blocked = await com.getBlocked(session);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].id).toEqual(u.id);

    await com.unblock(session, u);
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.devDeleteUser(u);
  });

  test('It should reject unblocking a not-blocked user', async () => {
    const u = await com.devCreateUser();
    await com.unblock(session, u, 404, { error: 'Not found' });

    expect(await com.getBlocked(session)).toHaveLength(0);
    await com.block(session, u);

    const blocked = await com.getBlocked(session);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].id).toEqual(u.id);

    await com.unblock(session, u);
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.unblock(session, u, 404, { error: 'Not found' });
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.devDeleteUser(u);
    expect(await com.getBlocked(session)).toHaveLength(0);
  });

  test('It should reject blocking an invalid user', async () => {
    const u = await com.devCreateUser();
    expect(await com.getBlocked(session)).toHaveLength(0);

    const invalidIds = [
      undefined,
      null,
      123,
      'hello',
      com.randomUserId(),
      com.randomUserId(),
    ];
    for (let i = 0; i < invalidIds.length; i += 1) {
      await com.block(session, { id: invalidIds[i] }, 404, {
        error: 'Not found',
      });
    }
    expect(await com.getBlocked(session)).toHaveLength(0);

    await com.devDeleteUser(u);
  });

  test('It should reject an invalid session', async () => {
    const u = await com.devCreateUser();
    com.testInvalidSessionsWith(async s => {
      return com.block(s, u, 403, {
        error: 'Invalid session',
      });
    });
  });
});

/* ------------------------------------------------------------------
Unfriend user
*/

describe('Test PUT /users/{id}/unfriend', () => {
  let Session;
  let session;
  let user;

  beforeAll(async () => {
    Session = await com.createSession();
    ({ user, session } = Session);
    expect(await com.devGetUsers()).toHaveLength(1);
  });

  afterAll(async () => {
    await com.deleteSession(Session);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  test('It should unfriend a friend', async () => {
    const friend = await com.devCreateUser();
    expect(await com.getFriends(session)).toHaveLength(0);
    await com.devMakeFriends(user, friend);
    const friends = await com.getFriends(session);
    expect(friends).toHaveLength(1);
    expect(friends[0].id).toEqual(friend.id);

    await com.unfriend(session, friend);
    expect(await com.getFriends(session)).toHaveLength(0);

    await com.devDeleteUser(friend);
  });

  test('It should reject unfriending a not-friend', async () => {
    const u = await com.devCreateUser();
    expect(await com.getFriends(session)).toHaveLength(0);
    const invalidIds = [
      undefined,
      null,
      123,
      'hello',
      -1,
      com.randomUserId(),
      com.randomUserId(),
    ];
    for (let i = 0; i < invalidIds.length; i += 1) {
      await com.unfriend(session, { id: invalidIds[i] }, 404, {
        error: 'Not found',
      });
    }
    expect(await com.getFriends(session)).toHaveLength(0);
    await com.devDeleteUser(u);
  });

  test('It should reject an invalid session', async () => {
    const u = await com.devCreateUser();
    com.testInvalidSessionsWith(async s => {
      return com.unfriend(s, u, 403, {
        error: 'Invalid session',
      });
    });
    await com.devDeleteUser(u);
  });
});

/* ------------------------------------------------------------------
Image
*/

describe('Test /images', () => {
  let SES;
  let session;
  beforeAll(async () => {
    SES = await com.createSession();
    ({ session } = SES);
    expect(await com.devGetUsers()).toHaveLength(1);
    expect(await com.devGetSessions()).toHaveLength(1);
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
  });
  afterAll(async () => {
    await com.deleteSession(SES);
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
  });

  describe('Test POST /images', () => {
    test('It should provide a working post url', async () => {
      expect(await com.devGetUploads()).toHaveLength(0);
      const image = await com.uploadImage(session, TEST_IMAGE_FILE_1);
      expect(await com.devGetUploads()).toHaveLength(1);
      await com.deleteImage(session, image);
      expect(await com.devGetUploads()).toHaveLength(0);
    });

    test('It should not create an image before put', async () => {
      expect(await com.devGetUploads()).toHaveLength(0);
      await com.createImage(session);
      expect(await com.devGetUploads()).toHaveLength(0);
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.createImage(s, 403, {
          error: 'Invalid session',
        });
      });
    });
  });

  describe('Test DELETE /images/{id}', () => {
    test('It should accept a valid image', async () => {
      expect(await com.devGetUploads()).toHaveLength(0);
      const image = await com.uploadImage(session, TEST_IMAGE_FILE_1);
      expect(await com.devGetUploads()).toHaveLength(1);
      await com.deleteImage(session, image);
      expect(await com.devGetUploads()).toHaveLength(0);
    });

    test('It should reject an invalid session', async () => {
      const image = await com.uploadImage(session, TEST_IMAGE_FILE_1);
      expect(await com.devGetUploads()).toHaveLength(1);
      com.testInvalidSessionsWith(async s => {
        return com.deleteImage(s, image, 403, {
          error: 'Invalid session',
        });
      });
      expect(await com.devGetUploads()).toHaveLength(1);
      await com.deleteImage(session, image);
      expect(await com.devGetUploads()).toHaveLength(0);
    });

    test('It should ignore an invalid image', async () => {
      const invalidImages = [
        undefined,
        123,
        'foo',
        com.randomFileId(),
        com.randomFileId(),
      ];
      for (let i = 0; i < invalidImages.length; i += 1) {
        await com.deleteImage(session, { id: invalidImages[i] });
      }
    });
  });

  describe('Test GET /images/url', () => {
    test('It should provide a valid get url for the user avatar', async () => {
      const S = await com.createSession();
      const { user: u, session: s } = S;
      const d1 = await com.getUserData(s);
      expect(d1.email).toEqual(u.email);
      expect(d1.avatar).toBe(null);

      expect(await com.devGetUploads()).toHaveLength(0);
      const image = await com.uploadImage(s, TEST_IMAGE_FILE_1);
      expect(await com.devGetUploads()).toHaveLength(1);

      const { avatar } = await com.changeAvatar(s, image);
      expect(avatar).toBeDefined();
      const d2 = await com.getUserData(s);
      expect(d2.avatar).not.toBe(null);

      await com.compareImageToFile(d2.avatar, TEST_IMAGE_FILE_1);

      await com.deleteAccount(s, u);
      expect(await com.devGetImages()).toHaveLength(0);

      await com.deleteImage(session, image);
      expect(await com.devGetUploads()).toHaveLength(0);
    });

    test('It should reject an invalid session', async () => {
      const d = await com.getUserData(session);
      com.testInvalidSessionsWith(async s => {
        return com.getImageURL(s, d.avatar, 403, {
          error: 'Invalid session',
        });
      });
    });

    test('It should reject an invalid input', async () => {
      const invalidImages = [undefined, null, 123, { hello: 'world' }];
      for (let i = 0; i < invalidImages.length; i += 1) {
        await com.getImageURLs(session, invalidImages[i], 400, {
          error: 'Invalid data',
        });
      }
    });

    test('It should provide a 404 URL for an invalid image', async () => {
      const url = await com.getImageURLs(session, [com.randomFileId()]);
      expect(url).toBeDefined();
      await com.getFile(url, 404);
    });
  });
});

/* ------------------------------------------------------------------
Postcards
*/

describe('Test /postcards', () => {
  let Session1;
  let Session2;
  let Session3;
  let sender;
  let s1;
  let receiver;
  let s2;
  // let other;
  let s3;
  let image;

  beforeAll(async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
    Session1 = await com.createSession();
    Session2 = await com.createSession();
    Session3 = await com.createSession();

    ({ user: sender, session: s1 } = Session1);
    ({ user: receiver, session: s2 } = Session2);
    ({ /* user: other, */ session: s3 } = Session3);

    image = await com.uploadImage(s1, TEST_IMAGE_FILE_2);

    expect(await com.devGetPostcards()).toHaveLength(0);
  });
  afterAll(async () => {
    await com.deleteImage(s1, image);
    await com.deleteSession(Session1);
    await com.deleteSession(Session2);
    await com.deleteSession(Session3);
    expect(await com.devGetPostcards()).toHaveLength(0);
    expect(await com.devGetUploads()).toHaveLength(0);
    expect(await com.devGetImages()).toHaveLength(0);
    expect(await com.devGetUsers()).toHaveLength(0);
  });

  /* ------------------------------------------------------------------
Send postcard
*/

  describe('Test POST /postcards', () => {
    test('It should create a new postcard', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);
      const p = await com.createPostcard(s1, postcard);

      const postcards = await com.devGetPostcards();
      const images = await com.devGetImages();
      expect(postcards).toHaveLength(1);
      expect(images).toHaveLength(1);

      expect(postcards[0].id).toEqual(p.id);
      expect(postcards[0].sender).toEqual(sender.id);
      expect(postcards[0].receiver).toEqual(receiver.id);
      expect(postcards[0].image).toEqual(images[0]);
      expect(postcards[0].message).toEqual(postcard.message);
      expect(postcards[0].location).toEqual(postcard.location);
      expect(postcards[0].created).toBeDefined();

      await com.devClearPostcards();
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should create a copy of an upload image', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const uploads = await com.devGetUploads();
      const i = await com.uploadImage(s1, TEST_IMAGE_FILE_2);
      expect(await com.devGetUploads()).toHaveLength(uploads.length + 1);

      const postcard = com.randomPostcard(receiver, i);
      const p = await com.createPostcard(s1, postcard);

      await com.deleteImage(s1, i);
      expect(await com.devGetUploads()).toHaveLength(uploads.length);

      const postcards = await com.devGetPostcards();
      const images = await com.devGetImages();
      expect(postcards).toHaveLength(1);
      expect(images).toHaveLength(1);

      expect(i.id).not.toEqual(postcards[0].id);

      expect(postcards[0].id).toEqual(p.id);
      expect(postcards[0].sender).toEqual(sender.id);
      expect(postcards[0].receiver).toEqual(receiver.id);
      expect(postcards[0].image).toEqual(images[0]);
      expect(postcards[0].message).toEqual(postcard.message);
      expect(postcards[0].location).toEqual(postcard.location);
      expect(postcards[0].created).toBeDefined();

      await com.compareImageToFile(postcards[0].image, TEST_IMAGE_FILE_2);

      await com.devClearPostcards();
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should reject an invalid session', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);
      com.testInvalidSessionsWith(async s => {
        return com.createPostcard(s, postcard, 403, {
          error: 'Invalid session',
        });
      });

      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should reject an invalid receiver', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const invalidIds = [
        undefined,
        null,
        123,
        'foo',
        {},
        com.randomUserId(),
        com.randomUserId(),
      ];
      for (let i = 0; i < invalidIds.length; i += 1) {
        const postcard = com.randomPostcard({ id: invalidIds[i] }, image);
        await com.createPostcard(s1, postcard, 400, {
          error: 'Invalid data',
        });
      }

      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should reject an invalid image', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const invalidIds = [
        undefined,
        null,
        123,
        'hello',
        com.randomFileId(),
        com.randomFileId(),
      ];
      for (let i = 0; i < invalidIds.length; i += 1) {
        const postcard = com.randomPostcard(receiver, { id: invalidIds[i] });
        await com.createPostcard(s1, postcard, 400, {
          error: 'Invalid data',
        });
      }

      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should handle the removed user special case', async () => {
      const sessions = await com.devGetSessions();
      const u = await com.devCreateUser();
      const s = await com.login(u);
      await com.devDeleteUser(u);
      expect(await com.devGetSessions()).toHaveLength(sessions.length + 1);

      const postcard = com.randomPostcard(receiver, image);

      expect(await com.devGetPostcards()).toHaveLength(0);

      await com.createPostcard(s, postcard, 409, {
        error: 'User not found',
      });

      expect(await com.devGetSessions()).toHaveLength(sessions.length);
      expect(await com.devGetPostcards()).toHaveLength(0);
    });

    test('Created postcard id should match the received and sent postcard ids', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);

      expect(await com.getSent(s1, {})).toHaveLength(0);

      const p = await com.createPostcard(s1, postcard);

      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(1);
      expect(postcards[0].id).toEqual(p.id);

      const inbox = await com.getInbox(s2, {});
      expect(inbox).toHaveLength(1);
      expect(inbox[0].postcard).toEqual(p.id);

      const ip = await com.getInboxPostcards(s2);
      expect(ip).toHaveLength(1);
      expect(ip[0].message).toEqual(postcard.message);
      expect(ip[0].location).toEqual(postcard.location);

      const sent = await com.getSent(s1, {});
      expect(sent).toHaveLength(1);
      expect(sent[0].postcard).toEqual(p.id);

      const sp = await com.getSentPostcards(s1);
      expect(sp).toHaveLength(1);
      expect(sp[0].message).toEqual(postcard.message);
      expect(sp[0].location).toEqual(postcard.location);

      await com.devClearPostcards();
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
      expect(await com.getInbox(s2, {})).toHaveLength(0);
      expect(await com.getSent(s1, {})).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------------------
Get batch postcards
*/

  describe('Test GET /postcards/batch', () => {
    const postcards = {};
    const numberOfPostcards = 10;

    beforeAll(async () => {
      for (let i = 0; i < numberOfPostcards; i += 1) {
        const postcard = com.randomPostcard(receiver, image);
        const p = await com.createPostcard(s1, postcard);
        postcards[p.id] = postcard;
      }
      expect(await com.devGetPostcards()).toHaveLength(numberOfPostcards);
    });

    afterAll(async () => {
      await com.devClearPostcards();
      expect(await com.devGetPostcards()).toHaveLength(0);
    });

    test('It should return postcards', async () => {
      const images = com.unique(await com.devGetImages()).sort();
      expect(images).toHaveLength(numberOfPostcards);

      const ids = Object.keys(postcards);
      const pp = await com.batchPostcards(s1, ids);
      expect(pp).toHaveLength(numberOfPostcards);

      pp.forEach(p => {
        expect(p.sender).toEqual(sender.id);
        expect(p.receiver).toEqual(postcards[p.id].receiver);
        expect(p.receiver).toEqual(receiver.id);
        expect(p.message).toEqual(postcards[p.id].message);
        expect(p.location).toEqual(postcards[p.id].location);
      });

      expect(images).toEqual(pp.map(p => p.image).sort());
    });

    test('It should return send and received postcards', async () => {
      const ids = Object.keys(postcards);

      const sent = await com.batchPostcards(s1, ids);
      expect(sent).toHaveLength(ids.length);
      expect(sent[0].sender).toEqual(sender.id);
      expect(ids.sort()).toEqual(sent.map(p => p.id).sort());

      const received = await com.batchPostcards(s1, ids);
      expect(received).toHaveLength(ids.length);
      expect(sent[0].receiver).toEqual(receiver.id);
      expect(ids.sort()).toEqual(received.map(p => p.id).sort());
    });

    test('It should not return postcards for third party', async () => {
      const ids = Object.keys(postcards);

      const sent = await com.batchPostcards(s1, ids);
      expect(sent).toHaveLength(ids.length);

      const received = await com.batchPostcards(s1, ids);
      expect(received).toHaveLength(ids.length);

      expect(await com.batchPostcards(s3, ids)).toHaveLength(0);
    });

    test('It should return a subset of postcards', async () => {
      const ids = Object.keys(postcards);
      const subset = [ids[1], ids[3], ids[4]];

      const pp = await com.batchPostcards(s1, subset);
      expect(pp).toHaveLength(subset.length);
      expect(subset.sort()).toEqual(pp.map(p => p.id).sort());
    });

    test('It should ignore duplicated postcards', async () => {
      const ids = Object.keys(postcards);
      const subset = [ids[1], ids[4], ids[1], ids[5]];
      const pp = await com.batchPostcards(s1, subset);

      const uniqueSubset = com.unique(subset);
      expect(pp).toHaveLength(uniqueSubset.length);

      expect(uniqueSubset.sort()).toEqual(pp.map(p => p.id).sort());
    });

    test('It should reject invalid postcards', async () => {
      const invalidIds = [undefined, null, 123, 'hello'];
      for (let i = 0; i < invalidIds.length; i += 1) {
        await com.batchPostcards(s1, invalidIds[i], 400, {
          error: 'Invalid data',
        });
      }
    });

    test('It should ignore missing postcards', async () => {
      const ids = Object.keys(postcards);
      expect(
        await com.batchPostcards(s1, [undefined, null, 123, 'hello'])
      ).toHaveLength(0);
      expect(
        await com.batchPostcards(s1, [
          com.randomPostcardId(),
          com.randomPostcardId(),
        ])
      ).toHaveLength(0);
      expect(
        await com.batchPostcards(s1, [ids[0], com.randomPostcardId()])
      ).toHaveLength(1);
      expect(
        await com.batchPostcards(s1, [
          ids[0],
          com.randomPostcardId(),
          ids[1],
          ids[2],
        ])
      ).toHaveLength(3);
    });

    test('It should reject an invalid session', async () => {
      const ids = Object.keys(postcards);
      com.testInvalidSessionsWith(async s => {
        return com.batchPostcards(s, ids, 403, {
          error: 'Invalid session',
        });
      });
    });
  });

  /* ------------------------------------------------------------------
Get batch postcards read status
*/

  describe('Test GET /postcards/batch-read', () => {
    const postcards = {};
    const numberOfPostcards = 10;

    beforeAll(async () => {
      for (let i = 0; i < numberOfPostcards; i += 1) {
        const postcard = com.randomPostcard(receiver, image);
        const p = await com.createPostcard(s1, postcard);
        postcards[p.id] = postcard;
      }
      expect(await com.devGetPostcards()).toHaveLength(numberOfPostcards);
    });

    afterAll(async () => {
      await com.devClearPostcards();
      expect(await com.devGetPostcards()).toHaveLength(0);
    });

    test('It should return the read status of postcards', async () => {
      const ids = Object.keys(postcards);

      let pp = await com.batchReadStatuses(s1, ids);
      expect(pp).toHaveLength(numberOfPostcards);

      pp.forEach(p => {
        expect(p.read).toBe(null);
      });

      await com.setAsRead(s2, { id: ids[0] });

      pp = await com.batchReadStatuses(s1, ids);
      expect(pp).toHaveLength(numberOfPostcards);
      const read = pp.filter(p => p.read !== null);
      expect(read).toHaveLength(1);
      expect(read[0].id).toEqual(ids[0]);
      expect(read[0].read).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/);
    });

    test('It should return send and received postcards', async () => {
      const ids = Object.keys(postcards);

      const sent = await com.batchReadStatuses(s1, ids);
      expect(sent).toHaveLength(ids.length);
      expect(ids.sort()).toEqual(sent.map(p => p.id).sort());

      const received = await com.batchReadStatuses(s2, ids);
      expect(received).toHaveLength(ids.length);
      expect(ids.sort()).toEqual(received.map(p => p.id).sort());
    });

    test('It should not return postcards for third party', async () => {
      const ids = Object.keys(postcards);

      const sent = await com.batchReadStatuses(s1, ids);
      expect(sent).toHaveLength(ids.length);

      const received = await com.batchReadStatuses(s1, ids);
      expect(received).toHaveLength(ids.length);

      expect(await com.batchReadStatuses(s3, ids)).toHaveLength(0);
    });

    test('It should return a subset of postcards', async () => {
      const ids = Object.keys(postcards);
      const subset = [ids[1], ids[3], ids[4]];

      const pp = await com.batchReadStatuses(s1, subset);
      expect(pp).toHaveLength(subset.length);
      expect(subset.sort()).toEqual(pp.map(p => p.id).sort());
    });

    test('It should ignore duplicated postcards', async () => {
      const ids = Object.keys(postcards);
      const subset = [ids[1], ids[4], ids[1], ids[5]];
      const pp = await com.batchReadStatuses(s1, subset);

      const uniqueSubset = com.unique(subset);
      expect(pp).toHaveLength(uniqueSubset.length);

      expect(uniqueSubset.sort()).toEqual(pp.map(p => p.id).sort());
    });

    test('It should reject invalid postcards', async () => {
      const invalidIds = [undefined, null, 123, 'hello'];
      for (let i = 0; i < invalidIds.length; i += 1) {
        await com.batchReadStatuses(s1, invalidIds[i], 400, {
          error: 'Invalid data',
        });
      }
    });

    test('It should ignore missing postcards', async () => {
      const ids = Object.keys(postcards);
      expect(
        await com.batchReadStatuses(s1, [undefined, null, 123, 'hello'])
      ).toHaveLength(0);
      expect(
        await com.batchReadStatuses(s1, [
          com.randomPostcardId(),
          com.randomPostcardId(),
        ])
      ).toHaveLength(0);
      expect(
        await com.batchReadStatuses(s1, [ids[0], com.randomPostcardId()])
      ).toHaveLength(1);
      expect(
        await com.batchReadStatuses(s1, [
          ids[0],
          com.randomPostcardId(),
          ids[1],
          ids[2],
        ])
      ).toHaveLength(3);
    });

    test('It should reject an invalid session', async () => {
      const ids = Object.keys(postcards);
      com.testInvalidSessionsWith(async s => {
        return com.batchReadStatuses(s, ids, 403, {
          error: 'Invalid session',
        });
      });
    });
  });

  /* ------------------------------------------------------------------
Get received postcards
*/

  describe('Test GET /postcards/inbox', () => {
    const numberOfPostcards = 10;

    beforeAll(async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
      for (let i = 0; i < numberOfPostcards; i += 1) {
        const postcard = com.randomPostcard(receiver, image);
        await com.createPostcard(s1, postcard);
      }
      expect(await com.devGetPostcards()).toHaveLength(numberOfPostcards);
      expect(await com.devGetImages()).toHaveLength(numberOfPostcards);
    });

    afterAll(async () => {
      await com.devClearPostcards();
      expect(await com.getInbox(s1, {})).toHaveLength(0);
      expect(await com.getInbox(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should return received postcards', async () => {
      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(numberOfPostcards);

      const inbox1 = await com.getInbox(s1, {});
      const inbox2 = await com.getInbox(s2, {});

      expect(inbox1).toHaveLength(0);
      expect(inbox2).toHaveLength(numberOfPostcards);

      const pp = await com.batchPostcards(s2, inbox2.map(i => i.postcard));
      expect(pp).toHaveLength(numberOfPostcards);

      expect(pp.map(p => p.id).sort()).toEqual(postcards.map(p => p.id).sort());
    });

    test('It should support a valid excludeStartIndex', async () => {
      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(numberOfPostcards);

      const inbox1 = await com.getInbox(s1, {});
      const inbox2 = await com.getInbox(s2, {});

      expect(inbox1).toHaveLength(0);
      expect(inbox2).toHaveLength(numberOfPostcards);

      const r1 = await com.getInbox(s2, { exclusiveStartIndex: 0 });
      expect(r1).toHaveLength(numberOfPostcards);

      const r2 = await com.getInbox(s2, { exclusiveStartIndex: 0 });
      expect(r2).toHaveLength(numberOfPostcards);

      const r3 = await com.getInbox(s2, {
        exclusiveStartIndex: r1[0].index,
      });
      expect(r3).toHaveLength(numberOfPostcards - 1);

      const r4 = await com.getInbox(s2, {
        exclusiveStartIndex: r1[4].index,
      });
      expect(r4).toHaveLength(numberOfPostcards - 5);

      const r5 = await com.getInbox(s2, {
        exclusiveStartIndex: r1[numberOfPostcards - 1].index,
      });
      expect(r5).toHaveLength(0);
    });

    test('It should support a valid limit', async () => {
      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(numberOfPostcards);

      const inbox1 = await com.getInbox(s1, {});
      const inbox2 = await com.getInbox(s2, {});

      expect(inbox1).toHaveLength(0);
      expect(inbox2).toHaveLength(numberOfPostcards);

      const f1 = await com.getInbox(s2);
      expect(f1).toHaveLength(numberOfPostcards);

      const f2 = await com.getInbox(s2, { limit: 1 });
      expect(f2).toHaveLength(1);

      const f3 = await com.getInbox(s2, {
        exclusiveStartIndex: f1[0].index,
        limit: 2,
      });
      expect(f3).toHaveLength(2);

      const f4 = await com.getInbox(s2, { limit: numberOfPostcards });
      expect(f4).toHaveLength(numberOfPostcards);

      const f5 = await com.getInbox(s2, { limit: numberOfPostcards + 1 });
      expect(f5).toHaveLength(numberOfPostcards);
    });

    test('It should reject an invalid exclusiveStartIndex', async () => {
      const invalidIndices = ['hello', -1];
      for (let i = 0; i < invalidIndices.length; i += 1) {
        await com.getInbox(
          s2,
          { exclusiveStartIndex: invalidIndices[i] },
          400,
          {
            error: 'Invalid data',
          }
        );
      }
    });

    test('It should reject an invalid limit', async () => {
      const invalidLimits = [-1, 0, 'hello', 10000];
      for (let i = 0; i < invalidLimits.length; i += 1) {
        await com.getInbox(s2, { limit: invalidLimits[i] }, 400, {
          error: 'Invalid data',
        });
      }
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.getInbox(s, {}, 403, {
          error: 'Invalid session',
        });
      });
    });
  });

  /* ------------------------------------------------------------------
Remove received postcard
*/

  describe('Test DELETE /postcards/inbox/{index}', () => {
    beforeAll(async () => {
      expect(await com.getInbox(s1, {})).toHaveLength(0);
      expect(await com.getInbox(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    afterAll(async () => {
      expect(await com.getInbox(s1, {})).toHaveLength(0);
      expect(await com.getInbox(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should remove a postcard from inbox', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);

      expect(await com.devGetPostcards()).toHaveLength(1);
      expect(await com.devGetImages()).toHaveLength(1);

      const inbox2 = await com.getInbox(s2, {});
      expect(inbox2).toHaveLength(1);
      expect(await com.getInbox(s1, {})).toHaveLength(0);

      await com.removeFromInbox(s2, inbox2[0]);

      expect(await com.getInbox(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(1);
      expect(await com.devGetImages()).toHaveLength(1);

      await com.devClearPostcards();
    });

    test('It should reject a missing postcard', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const inbox2 = await com.getInbox(s2, {});
      expect(inbox2).toHaveLength(1);
      expect(await com.getInbox(s1, {})).toHaveLength(0);

      await com.removeFromInbox(s2, { index: inbox2[0].index + 1 }, 404, {
        error: 'Not found',
      });
      await com.removeFromInbox(s1, inbox2[0], 404, { error: 'Not found' });

      const invalidIndices = [undefined, null, 123, 'hello'];
      for (let i = 0; i < invalidIndices.length; i += 1) {
        await com.removeFromInbox(s2, { index: invalidIndices[i] }, 404, {
          error: 'Not found',
        });
      }

      expect(await com.getInbox(s2, {})).toHaveLength(1);
      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });

    test('It should reject an invalid session', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const inbox2 = await com.getInbox(s2, {});
      expect(inbox2).toHaveLength(1);

      com.testInvalidSessionsWith(async s => {
        return com.removeFromInbox(s, inbox2[0], 403, {
          error: 'Invalid session',
        });
      });
      expect(await com.getInbox(s2, {})).toHaveLength(1);
      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });
  });

  /* ------------------------------------------------------------------
Mark postcard as read
*/

  describe('Test PUT /postcards/{id}/read', () => {
    beforeAll(async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
    });

    afterAll(async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
    });

    test('It should set the postcard as read', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);

      expect(await com.devGetPostcards()).toHaveLength(1);

      const [p1, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);
      expect(p1.read).toBe(null);

      await com.setAsRead(s2, p1);

      const [p2] = await com.batchPostcards(s2, [p1.id]);
      expect(p2.read).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/);

      await com.devClearPostcards();
    });

    test('It should ignore setting the postcard read multiple times', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);

      expect(await com.devGetPostcards()).toHaveLength(1);

      const [p1, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);
      expect(p1.read).toBe(null);

      await com.setAsRead(s2, p1);

      const [p2] = await com.batchPostcards(s2, [p1.id]);
      expect(p2.read).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/);
      const { read } = p2;

      await com.setAsRead(s2, p2);

      const [p3] = await com.batchPostcards(s2, [p1.id]);
      expect(p3.read).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/);
      expect(p3.read).toEqual(read);

      await com.devClearPostcards();
    });

    test('It should reject a missing postcard', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const [p1, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);
      expect(p1.read).toBe(null);

      await com.setAsRead(s2, { id: com.randomPostcardId() }, 404, {
        error: 'Not found',
      });

      const invalidIds = [undefined, null, 123, 'hello'];
      for (let i = 0; i < invalidIds.length; i += 1) {
        await com.setAsRead(s2, { id: invalidIds[i] }, 404, {
          error: 'Not found',
        });
      }

      const [p2] = await com.batchPostcards(s2, [p1.id]);
      expect(p2.read).toEqual(null);

      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });

    test('It should reject a not-received postcard', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const [p1, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);
      expect(p1.read).toBe(null);

      await com.setAsRead(s1, p1, 404, { error: 'Not found' });
      await com.setAsRead(s3, p1, 404, { error: 'Not found' });

      const [p2] = await com.batchPostcards(s2, [p1.id]);
      expect(p2.read).toEqual(null);

      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });

    test('It should reject an invalid session', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const [p1, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);
      expect(p1.read).toBe(null);

      com.testInvalidSessionsWith(async s => {
        return com.setAsRead(s, p1, 403, {
          error: 'Invalid session',
        });
      });

      const [p2] = await com.batchPostcards(s2, [p1.id]);
      expect(p2.read).toEqual(null);

      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });
  });

  /* ------------------------------------------------------------------
Become friends with the sender of the received postcard
*/

  describe('Test POST /postcards/{id}/connect', () => {
    beforeAll(async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);
    });

    afterAll(async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);
    });

    test('It should connect both the sender and receiver', async () => {
      await com.sendRandomPostcard(s1, receiver, image);

      const [p, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);

      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);

      await com.connectToSender(s2, p);

      const friends1 = await com.getFriends(s1, {});
      const friends2 = await com.getFriends(s2, {});
      expect(friends1).toHaveLength(1);
      expect(friends2).toHaveLength(1);
      expect(friends1[0].id).toEqual(receiver.id);
      expect(friends2[0].id).toEqual(sender.id);

      await com.devClearPostcards();
      await com.devClearFriends();
      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);
    });

    test('It should reject a not-received postcard', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const [p1, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);
      expect(p1.read).toBe(null);

      await com.connectToSender(s1, p1, 404, { error: 'Not found' });
      await com.connectToSender(s3, p1, 404, { error: 'Not found' });

      const [p2] = await com.batchPostcards(s2, [p1.id]);
      expect(p2.read).toEqual(null);

      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });

    test('It should reject a missing postcard', async () => {
      await com.sendRandomPostcard(s1, receiver, image);

      const [p, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);

      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);

      await com.connectToSender(s2, { id: com.randomPostcardId() }, 404, {
        error: 'Not found',
      });
      await com.connectToSender(s1, p, 404, { error: 'Not found' });

      const invalidIds = [undefined, null, 123, 'hello'];
      for (let i = 0; i < invalidIds.length; i += 1) {
        await com.connectToSender(s2, { id: invalidIds[i] }, 404, {
          error: 'Not found',
        });
      }

      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);

      await com.devClearPostcards();
    });

    test('It should reject an invalid session', async () => {
      await com.sendRandomPostcard(s1, receiver, image);

      const [p, ...rest] = await com.getInboxPostcards(s2);
      expect(rest).toHaveLength(0);

      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);

      com.testInvalidSessionsWith(async s => {
        return com.connectToSender(s, p, 403, {
          error: 'Invalid session',
        });
      });

      expect(await com.getFriends(s1, {})).toHaveLength(0);
      expect(await com.getFriends(s2, {})).toHaveLength(0);
      await com.devClearPostcards();
    });

    test('It should handle the removed sender special case', async () => {
      const users = await com.devGetUsers();
      const SS1 = await com.createSession();
      const SS2 = await com.createSession();
      const { user: uu1, session: ss1 } = SS1;
      const { user: uu2, session: ss2 } = SS2;

      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetUsers()).toHaveLength(users.length + 2);

      await com.sendRandomPostcard(ss1, uu2, image);

      const [p, ...rest] = await com.getInboxPostcards(ss2);
      expect(rest).toHaveLength(0);

      expect(await com.getFriends(ss1, {})).toHaveLength(0);
      expect(await com.getFriends(ss2, {})).toHaveLength(0);

      await com.deleteAccount(ss1, uu1);

      expect(await com.devGetUsers()).toHaveLength(users.length + 1);
      expect(await com.devGetPostcards()).toHaveLength(1);

      await com.connectToSender(ss2, p, 404, {
        error: 'Not found',
      });

      expect(await com.getFriends(ss2, {})).toHaveLength(0);

      await com.deleteAccount(ss2, uu2);
      expect(await com.devGetUsers()).toHaveLength(users.length);

      await com.devClearPostcards();
    });

    test('It should handle the removed receiver special case', async () => {
      const users = await com.devGetUsers();
      const sessions = await com.devGetSessions();
      expect(users.length).toEqual(sessions.length);

      const SS1 = await com.createSession();
      const SS2 = await com.createSession();
      const { user: uu1, session: ss1 } = SS1;
      const { user: uu2, session: ss2 } = SS2;

      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetUsers()).toHaveLength(users.length + 2);
      expect(await com.devGetSessions()).toHaveLength(sessions.length + 2);

      await com.sendRandomPostcard(ss1, uu2, image);

      const [p, ...rest] = await com.getInboxPostcards(ss2);
      expect(rest).toHaveLength(0);

      expect(await com.getFriends(ss1, {})).toHaveLength(0);
      expect(await com.getFriends(ss2, {})).toHaveLength(0);

      await com.devDeleteUser(uu2);
      expect(await com.devGetUsers()).toHaveLength(users.length + 1);
      expect(await com.devGetSessions()).toHaveLength(sessions.length + 2);
      expect(await com.devGetPostcards()).toHaveLength(1);

      await com.connectToSender(ss2, p, 404, {
        error: 'Not found',
      });

      expect(await com.getFriends(ss1, {})).toHaveLength(0);

      await com.deleteAccount(ss1, uu1);
      await com.logout(ss2);
      expect(await com.devGetUsers()).toHaveLength(users.length);
      expect(await com.devGetSessions()).toHaveLength(sessions.length);

      await com.devClearPostcards();
    });
  });

  /* ------------------------------------------------------------------
Get sent postcards
*/

  describe('Test GET /postcards/sent', () => {
    const numberOfPostcards = 10;

    beforeAll(async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
      for (let i = 0; i < numberOfPostcards; i += 1) {
        const postcard = com.randomPostcard(receiver, image);
        await com.createPostcard(s1, postcard);
      }
      expect(await com.devGetPostcards()).toHaveLength(numberOfPostcards);
      expect(await com.devGetImages()).toHaveLength(numberOfPostcards);
    });

    afterAll(async () => {
      await com.devClearPostcards();
      expect(await com.getSent(s1, {})).toHaveLength(0);
      expect(await com.getSent(s2, {})).toHaveLength(0);
      expect(await com.getInbox(s1, {})).toHaveLength(0);
      expect(await com.getInbox(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should return sent postcards', async () => {
      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(numberOfPostcards);

      const inbox1 = await com.getInbox(s1, {});
      const inbox2 = await com.getInbox(s2, {});

      const sent1 = await com.getSent(s1, {});
      const sent2 = await com.getSent(s2, {});

      expect(inbox1).toHaveLength(0);
      expect(inbox2).toHaveLength(numberOfPostcards);

      expect(sent1).toHaveLength(numberOfPostcards);
      expect(sent2).toHaveLength(0);

      expect(sent1.map(s => s.postcard).sort()).toEqual(
        inbox2.map(i => i.postcard).sort()
      );
    });

    test('It should support a valid excludeStartIndex', async () => {
      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(numberOfPostcards);

      const sent1 = await com.getSent(s1, {});
      const sent2 = await com.getSent(s2, {});

      expect(sent1).toHaveLength(numberOfPostcards);
      expect(sent2).toHaveLength(0);

      const r1 = await com.getSent(s1, { exclusiveStartIndex: 0 });
      expect(r1).toHaveLength(numberOfPostcards);

      const r2 = await com.getSent(s1, { exclusiveStartIndex: 0 });
      expect(r2).toHaveLength(numberOfPostcards);

      const r3 = await com.getSent(s1, {
        exclusiveStartIndex: r1[0].index,
      });
      expect(r3).toHaveLength(numberOfPostcards - 1);

      const r4 = await com.getSent(s1, {
        exclusiveStartIndex: r1[4].index,
      });
      expect(r4).toHaveLength(numberOfPostcards - 5);

      const r5 = await com.getSent(s1, {
        exclusiveStartIndex: r1[numberOfPostcards - 1].index,
      });
      expect(r5).toHaveLength(0);
    });

    test('It should support a valid limit', async () => {
      const postcards = await com.devGetPostcards();
      expect(postcards).toHaveLength(numberOfPostcards);

      const sent1 = await com.getSent(s1, {});
      const sent2 = await com.getSent(s2, {});

      expect(sent1).toHaveLength(numberOfPostcards);
      expect(sent2).toHaveLength(0);

      const f1 = await com.getSent(s1);
      expect(f1).toHaveLength(numberOfPostcards);

      const f2 = await com.getSent(s1, { limit: 1 });
      expect(f2).toHaveLength(1);

      const f3 = await com.getSent(s1, {
        exclusiveStartIndex: f1[0].index,
        limit: 2,
      });
      expect(f3).toHaveLength(2);

      const f4 = await com.getSent(s1, { limit: numberOfPostcards });
      expect(f4).toHaveLength(numberOfPostcards);

      const f5 = await com.getSent(s1, { limit: numberOfPostcards + 1 });
      expect(f5).toHaveLength(numberOfPostcards);
    });

    test('It should reject an invalid exclusiveStartIndex', async () => {
      const invalidIndices = ['hello', -1];
      for (let i = 0; i < invalidIndices.length; i += 1) {
        await com.getSent(s1, { exclusiveStartIndex: invalidIndices[i] }, 400, {
          error: 'Invalid data',
        });
      }
    });

    test('It should reject an invalid limit', async () => {
      const invalidLimits = [-1, 0, 'hello', 10000];
      for (let i = 0; i < invalidLimits.length; i += 1) {
        await com.getSent(s1, { limit: invalidLimits[i] }, 400, {
          error: 'Invalid data',
        });
      }
    });

    test('It should reject an invalid session', async () => {
      com.testInvalidSessionsWith(async s => {
        return com.getSent(s, {}, 403, {
          error: 'Invalid session',
        });
      });
    });
  });

  /* ------------------------------------------------------------------
Remove sent postcard
*/

  describe('Test DELETE /postcards/sent/{index}', () => {
    beforeAll(async () => {
      expect(await com.getSent(s1, {})).toHaveLength(0);
      expect(await com.getSent(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    afterAll(async () => {
      expect(await com.getSent(s1, {})).toHaveLength(0);
      expect(await com.getSent(s2, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);
    });

    test('It should remove a postcard from sentbox', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      expect(await com.devGetImages()).toHaveLength(0);

      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);

      expect(await com.devGetPostcards()).toHaveLength(1);
      expect(await com.devGetImages()).toHaveLength(1);

      const sent1 = await com.getSent(s1, {});
      expect(sent1).toHaveLength(1);
      expect(await com.getSent(s2, {})).toHaveLength(0);

      await com.removeFromSent(s1, sent1[0]);

      expect(await com.getSent(s1, {})).toHaveLength(0);
      expect(await com.devGetPostcards()).toHaveLength(1);
      expect(await com.devGetImages()).toHaveLength(1);

      await com.devClearPostcards();
    });

    test('It should reject a missing postcard', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const sent1 = await com.getSent(s1, {});
      expect(sent1).toHaveLength(1);
      expect(await com.getSent(s2, {})).toHaveLength(0);

      await com.removeFromSent(s1, { index: sent1[0].index + 1 }, 404, {
        error: 'Not found',
      });
      await com.removeFromSent(s2, sent1[0], 404, { error: 'Not found' });

      const invalidIndices = [undefined, null, 123, 'hello'];
      for (let i = 0; i < invalidIndices.length; i += 1) {
        await com.removeFromSent(s1, { index: invalidIndices[i] }, 404, {
          error: 'Not found',
        });
      }

      expect(await com.getSent(s1, {})).toHaveLength(1);
      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });

    test('It should reject an invalid session', async () => {
      expect(await com.devGetPostcards()).toHaveLength(0);
      const postcard = com.randomPostcard(receiver, image);
      await com.createPostcard(s1, postcard);
      expect(await com.devGetPostcards()).toHaveLength(1);

      const sent1 = await com.getSent(s1, {});
      expect(sent1).toHaveLength(1);

      com.testInvalidSessionsWith(async s => {
        return com.removeFromSent(s, sent1[0], 403, {
          error: 'Invalid session',
        });
      });
      expect(await com.getSent(s1, {})).toHaveLength(1);
      expect(await com.devGetPostcards()).toHaveLength(1);
      await com.devClearPostcards();
    });
  });
});

/* ------------------------------------------------------------------
Check events
*/

describe('Test /me/endpoint', () => {
  beforeAll(async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
  });
  afterAll(async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
  });
  test('It should create a new endpoint', async () => {
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    const S1 = await com.createSession();
    const { session: s1 } = S1;

    const { id, expires } = await com.createEndpoint(s1);
    expect(id).toBeDefined();
    expect(expires).toBeDefined();
    expect(parseInt(expires, 10)).toBeGreaterThanOrEqual(Date.now());

    await com.deleteSession(S1);

    expect(await com.devGetEndpointRequests()).toHaveLength(1);
    await com.devClearRequests();
    expect(await com.devGetEndpointRequests()).toHaveLength(0);
  });

  test('It should reject an invalid session', async () => {
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    com.testInvalidSessionsWith(async s => {
      return com.createEndpoint(s, 403, {
        error: 'Invalid session',
      });
    });

    expect(await com.devGetEndpointRequests()).toHaveLength(0);
  });
});

describe('Test /endpoints/{id}', () => {
  let S1;
  let S2;
  let testImage;

  beforeAll(async () => {
    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);

    S1 = await com.createSession();
    S2 = await com.createSession();
    testImage = await com.uploadImage(S1.session, TEST_IMAGE_FILE_1);

    expect(await com.devGetUsers()).toHaveLength(2);
    expect(await com.devGetSessions()).toHaveLength(2);
    expect(await com.devGetUploads()).toHaveLength(1);
  });

  afterAll(async () => {
    await com.deleteImage(S1.session, testImage);
    await com.deleteSession(S1);
    await com.deleteSession(S2);

    expect(await com.devGetUsers()).toHaveLength(0);
    expect(await com.devGetSessions()).toHaveLength(0);
    expect(await com.devGetUploads()).toHaveLength(0);
  });

  test('It should connect to a valid endpoint', async () => {
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    const { session: s1 } = S1;

    const [ep] = await com.createEndpoints([s1]);
    expect(await com.devGetEndpointRequests()).toHaveLength(1);

    const [ws] = await com.connectToEndpoints([ep]);
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    ws.close();
  });

  test('It should remove the endpoint after connection', async () => {
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    const { session: s1 } = S1;

    const [ep] = await com.createEndpoints([s1]);
    expect(await com.devGetEndpointRequests()).toHaveLength(1);

    const [ws] = await com.connectToEndpoints([ep]);
    expect(await com.devGetEndpointRequests()).toHaveLength(0);
    await com.connectToInvalidEndpoint(ep);

    ws.close();
  });

  test('It should not connect to an invalid endpoint', async () => {
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    const { session: s1 } = S1;

    const [ep] = await com.createEndpoints([s1]);
    expect(await com.devGetEndpointRequests()).toHaveLength(1);

    const [ws] = await com.connectToEndpoints([ep]);
    expect(await com.devGetEndpointRequests()).toHaveLength(0);

    await com.connectToInvalidEndpoint(ep);
    ws.close();

    const invalidIds = [
      undefined,
      null,
      123,
      'hello',
      com.randomEndpointId(),
      com.randomEndpointId(),
    ];
    for (let i = 0; i < invalidIds.length; i += 1) {
      await com.connectToInvalidEndpoint({ id: invalidIds[i] });
    }
  });

  test('It should notify a received postcard', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;

    const [ep] = await com.createEndpoints([s2]);
    const [ws] = await com.connectToEndpoints([ep]);
    const [mb] = com.bufferMessages([ws]);

    const postcard = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);

    const m = await com.waitForBuffer(mb);
    expect(m[0]).toEqual({ type: 'postcard-received', id: postcard.id });

    ws.close();

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should not notify a received postcard to third party', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;
    const S3 = await com.createSession();

    const [ep1, ep2, ep3] = await com.createEndpoints([s1, s2, S3.session]);
    const [ws1, ws2, ws3] = await com.connectToEndpoints([ep1, ep2, ep3]);
    const [mb1, mb2, mb3] = com.bufferMessages([ws1, ws2, ws3]);

    const postcard = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);

    await com.waitForPong([ws1, ws2, ws3]);

    expect(mb1.messages()).toHaveLength(0);
    const m2 = mb2.messages();
    expect(m2).toHaveLength(1);
    expect(m2[0]).toEqual({
      type: 'postcard-received',
      id: postcard.id,
    });
    expect(mb3.messages()).toHaveLength(0);

    await com.deleteSession(S3);

    [ws1, ws2, ws3].forEach(ws => ws.close());

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should notify a delivered postcard', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;

    const [ep] = await com.createEndpoints([s1]);
    const [ws] = await com.connectToEndpoints([ep]);
    const [mb] = com.bufferMessages([ws]);

    const postcard = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);
    await com.setAsRead(s2, postcard);

    const m = await com.waitForBuffer(mb);
    expect(m[0]).toEqual({ type: 'postcard-delivered', id: postcard.id });

    ws.close();

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should not notify a delivered postcard to third party', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;
    const S3 = await com.createSession();

    const [ep1, ep2, ep3] = await com.createEndpoints([s1, s2, S3.session]);
    const [ws1, ws2, ws3] = await com.connectToEndpoints([ep1, ep2, ep3]);
    const [mb1, mb2, mb3] = com.bufferMessages([ws1, ws2, ws3]);

    const postcard = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);
    await com.setAsRead(s2, postcard);

    await com.waitForPong([ws1, ws2, ws3]);

    const m1 = mb1.messages();
    expect(m1).toHaveLength(1);
    expect(m1[0]).toEqual({
      type: 'postcard-delivered',
      id: postcard.id,
    });
    const m2 = mb2.messages();
    expect(m2).toHaveLength(1);
    expect(m2[0]).toEqual({
      type: 'postcard-received',
      id: postcard.id,
    });
    expect(mb3.messages()).toHaveLength(0);

    await com.deleteSession(S3);

    [ws1, ws2, ws3].forEach(ws => ws.close());

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should notify when set as friend', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;

    const [ep] = await com.createEndpoints([s1]);
    const [ws] = await com.connectToEndpoints([ep]);
    const [mb] = com.bufferMessages([ws]);

    const postcard = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);
    await com.connectToSender(s2, postcard);

    const m = await com.waitForBuffer(mb);
    expect(m[0]).toEqual({ type: 'set-as-friend', id: u2.id });

    ws.close();

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should not notify when set as friend to third party', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;
    const S3 = await com.createSession();

    const [ep1, ep2, ep3] = await com.createEndpoints([s1, s2, S3.session]);
    const [ws1, ws2, ws3] = await com.connectToEndpoints([ep1, ep2, ep3]);
    const [mb1, mb2, mb3] = com.bufferMessages([ws1, ws2, ws3]);

    const postcard = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);
    await com.connectToSender(s2, postcard);

    await com.waitForPong([ws1, ws2, ws3]);

    const m1 = mb1.messages();
    expect(m1).toHaveLength(1);
    expect(m1[0]).toEqual({ type: 'set-as-friend', id: u2.id });
    const m2 = mb2.messages();
    expect(m2).toHaveLength(1);
    expect(m2[0]).toEqual({ type: 'postcard-received', id: postcard.id });
    expect(mb3.messages()).toHaveLength(0);

    await com.deleteSession(S3);

    [ws1, ws2, ws3].forEach(ws => ws.close());

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should close the connection on logout', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const S3 = await com.createSession();
    const { user: u3, session: s3 } = S3;

    const [ep1, ep3] = await com.createEndpoints([s1, s3]);
    const [ws1, ws3] = await com.connectToEndpoints([ep1, ep3]);
    const [mb1, mb3] = com.bufferMessages([ws1, ws3]);
    const cb3 = com.bufferClose(ws3);

    const postcard = await com.sendRandomPostcard(s1, u3, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);

    await com.waitForPong([ws1, ws3]);

    expect(mb1.messages()).toHaveLength(0);
    const m3 = await com.waitForBuffer(mb3, 1);
    expect(m3[0]).toEqual({ type: 'postcard-received', id: postcard.id });

    expect(cb3.messages()).toHaveLength(0);
    await com.logout(s3);
    await com.waitForBuffer(cb3);

    await com.devDeleteUser(u3);

    ws1.close();

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });

  test('It should echo sent messages', async () => {
    const { session: s1 } = S1;

    const [ep] = await com.createEndpoints([s1]);
    const [ws] = await com.connectToEndpoints([ep]);
    const [mb] = com.bufferMessages([ws]);

    const message = 'HELLO';
    ws.send(message);

    const m = await com.waitForBuffer(mb);
    expect(m[0]).toEqual(message);

    ws.close();
  });

  test('It should close the existing connection when a new connection is opened', async () => {
    expect(await com.devGetPostcards()).toHaveLength(0);

    const { session: s1 } = S1;
    const { user: u2, session: s2 } = S2;

    const [ep1, ep2] = await com.createEndpoints([s1, s2]);
    const [ws1, ws2] = await com.connectToEndpoints([ep1, ep2]);
    const [mb1, mb2] = com.bufferMessages([ws1, ws2]);
    const cb2 = com.bufferClose(ws2);

    const postcard1 = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(1);

    await com.waitForPong([ws1, ws2]);

    expect(mb1.messages()).toHaveLength(0);
    const m2 = await com.waitForBuffer(mb2, 1);
    expect(m2[0]).toEqual({ type: 'postcard-received', id: postcard1.id });

    expect(cb2.messages()).toHaveLength(0);

    const [ep22] = await com.createEndpoints([s2]);
    await com.waitForPong([ws2]);
    expect(cb2.messages()).toHaveLength(0);

    const [ws22] = await com.connectToEndpoints([ep22]);
    const [mb22] = com.bufferMessages([ws22]);

    await com.waitForBuffer(cb2);

    const postcard2 = await com.sendRandomPostcard(s1, u2, testImage);
    expect(await com.devGetPostcards()).toHaveLength(2);

    expect(mb1.messages()).toHaveLength(0);
    const m22 = await com.waitForBuffer(mb22, 1);
    expect(m22[0]).toEqual({ type: 'postcard-received', id: postcard2.id });

    ws1.close();
    ws22.close();

    await com.devClearPostcards();
    expect(await com.devGetPostcards()).toHaveLength(0);
  });
});
