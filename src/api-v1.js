/*
 *
 */
const express = require('express');

const apiutils = require('./apiutils');
const database = require('./database');
const filestore = require('./filestore');
const reqstore = require('./reqstore');
const emailer = require('./emailer');
const sesstore = require('./sesstore');
const publisher = require('./publisher');
const config = require('./config');

const router = express.Router();
const {
  asyncmw,
  sesmw,
  sendReply,
  sendError,
  validateName,
  validateEmail,
  validatePassword,
  validateLanguage,
  hashPassword,
  comparePassword,
  reqSession,
  reqUser,
  endSession,
} = apiutils;
const { queryLimit } = config;

router.get('/healthz', async (req, res) => {
  sendReply(res, 204);
});

router.get(
  '/registrations/available',
  asyncmw(async (req, res) => {
    const { email } = req.query;
    const validEmail = validateEmail(email);
    if (!validEmail) {
      return sendError(res, 400, 'Invalid data');
    }
    const user = await database.findUser(validEmail);
    return sendReply(res, 200, {
      email: !database.isRegisteredUser(user),
    });
  })
);

router.post(
  '/registrations',
  asyncmw(async (req, res) => {
    const { firstName, lastName, email, password, language } = req.body;
    const validFirstName = validateName(firstName);
    const validLastName = validateName(lastName);
    const validEmail = validateEmail(email);
    const validPassword = validatePassword(password);
    const validLanguage = validateLanguage(language);
    if (
      !validFirstName ||
      !validLastName ||
      !validEmail ||
      !validPassword ||
      !validLanguage
    ) {
      return sendError(res, 400, 'Invalid data');
    }
    const user = await database.findUser(validEmail);
    if (database.isRegisteredUser(user)) {
      return sendError(res, 409, 'User already exists');
    }
    const passhash = await hashPassword(password);
    const { id, expires } = await reqstore.createRegistrationRequest({
      firstName,
      lastName,
      email,
      passhash,
      language,
    });
    await emailer.registration({
      id,
      email,
      firstName,
      lastName,
      language,
    });
    return sendReply(res, 202, { expires });
  })
);

router.post(
  '/registrations/:id',
  asyncmw(async (req, res) => {
    const { id } = req.params;
    const u = await reqstore.resolveRegistrationRequest(id);
    if (!u) {
      return sendError(res, 404, 'Not found');
    }
    let user = await database.findUser(u.email);
    if (database.isRegisteredUser(user)) {
      return sendError(res, 409, 'User already exists');
    }
    user = await database.addOrModifyUser(u);
    return sendReply(res, 201, {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
  })
);

router.post(
  '/password_resets',
  asyncmw(async (req, res) => {
    const { email } = req.body;
    const validEmail = validateEmail(email);
    if (!validEmail) {
      return sendError(res, 400, 'Invalid data');
    }
    const user = await database.findUser(validEmail);
    if (!database.isRegisteredUser(user)) {
      return sendError(res, 404, 'Not found');
    }
    const { id, expires } = await reqstore.createPasswordResetRequest({
      userId: user.id,
    });
    await emailer.resetPassword({
      id,
      email,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
    });
    return sendReply(res, 202, { expires });
  })
);

router.post(
  '/password_resets/:id',
  asyncmw(async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    /* check input errors before resolving the request */
    const validPassword = validatePassword(password);
    if (!validPassword) {
      return sendError(res, 400, 'Invalid data');
    }
    const r = await reqstore.resolvePasswordResetRequest(id);
    if (!r) {
      return sendError(res, 404, 'Not found');
    }
    const passhash = await hashPassword(validPassword);
    const user = await database.modifyUser(r.userId, { passhash });
    if (!user) {
      return sendError(res, 409, 'User not found');
    }
    const { firstName, lastName, email } = user;
    return sendReply(res, 200, { firstName, lastName, email });
  })
);

router.post(
  '/email_changes/:id',
  asyncmw(async (req, res) => {
    const { id } = req.params;
    const r = await reqstore.resolveEmailChangeRequest(id);
    if (!r) {
      return sendError(res, 404, 'Not found');
    }
    const { userId, newEmail } = r;
    const user = await database.modifyUser(userId, {
      email: newEmail,
    });
    if (!user) {
      return sendError(res, 409, 'User not found');
    }
    return sendReply(res, 200, {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
  })
);

router.post(
  '/invites/:id',
  asyncmw(async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, password, language } = req.body;
    /* check input errors before resolving the invite */
    const validFirstName = validateName(firstName);
    const validLastName = validateName(lastName);
    const validPassword = validatePassword(password);
    const validLanguage = validateLanguage(language);
    if (!validFirstName || !validLastName || !validPassword || !validLanguage) {
      return sendError(res, 400, 'Invalid data');
    }
    const invite = await database.deleteInvite(id);
    if (!invite) {
      return sendError(res, 404, 'Not found');
    }
    const passhash = await hashPassword(validPassword);
    const user = await database.modifyUser(invite.user, {
      firstName: validFirstName,
      lastName: validLastName,
      passhash,
      language: validLanguage,
    });
    if (!user) {
      /* should never happen IRL */
      return sendError(res, 409, 'User not found');
    }
    return sendReply(res, 200, {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
  })
);

router.delete(
  '/invites/:id',
  asyncmw(async (req, res) => {
    const { id } = req.params;
    const invite = await database.deleteInvite(id);
    if (!invite) {
      return sendError(res, 404, 'Not found');
    }
    const u = await database.getUser(invite.user);
    if (u && !database.isRegisteredUser(u)) {
      await database.deleteUser(u.id);
    }
    if (u) {
      /* this should always happen IRL */
      await database.ignore(u.email);
    }
    return sendReply(res, 204);
  })
);

router.post(
  '/me/login',
  asyncmw(async (req, res) => {
    const { email, password } = req.body;
    const validEmail = validateEmail(email);
    if (!validEmail) {
      return sendError(res, 400, 'Invalid data');
    }
    const user = await database.findUser(validEmail);
    if (!user) {
      return sendError(res, 400, 'Invalid data');
    }
    const { passhash } = user;
    const match = await comparePassword(password, passhash);
    if (!match) {
      return sendError(res, 400, 'Invalid data');
    }
    return sendReply(res, 201, await sesstore.startSession(user.id));
  })
);

router.post(
  '/me/renew',
  sesmw,
  asyncmw(async (req, res) => {
    const session = reqSession(req);
    const s = await sesstore.renewSession(session);
    if (!s) {
      return sendError(res, 403, 'Invalid session');
    }
    return sendReply(res, 200, s);
  })
);

router.post(
  '/me/logout',
  sesmw,
  asyncmw(async (req, res) => {
    await endSession(req);
    return sendReply(res, 204);
  })
);

router.get(
  '/me',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const user = await database.getUser(uid);
    if (!user) {
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    return sendReply(res, 200, {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      language: user.language,
      avatar: user.avatar,
    });
  })
);

router.delete(
  '/me',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { password } = req.body;
    const user = await database.getUser(uid);
    if (!user) {
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    const { passhash } = user;
    const match = await comparePassword(password, passhash);
    if (!match) {
      return sendError(res, 403, 'Invalid password');
    }
    await database.deleteUser(uid);
    if (user.avatar) {
      await filestore.deleteImage(user.avatar);
    }
    await endSession(req);
    return sendReply(res, 204);
  })
);

router.put(
  '/me/email',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { password, newEmail } = req.body;
    const user = await database.getUser(uid);
    if (!user) {
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    const validEmail = validateEmail(newEmail);
    if (!validEmail) {
      return sendError(res, 400, 'Invalid data');
    }
    const { passhash } = user;
    const match = await comparePassword(password, passhash);
    if (!match) {
      return sendError(res, 403, 'Invalid password');
    }
    const { id, expires } = await reqstore.createEmailChangeRequest({
      userId: user.id,
      newEmail,
    });
    await emailer.changeEmail({
      id,
      email: newEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
    });
    return sendReply(res, 202, { expires });
  })
);

router.put(
  '/me/password',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { password, newPassword } = req.body;
    const user = await database.getUser(uid);
    if (!user) {
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    const validPassword = validatePassword(newPassword);
    if (!validPassword) {
      return sendError(res, 400, 'Invalid data');
    }
    const { passhash } = user;
    const match = await comparePassword(password, passhash);
    if (!match) {
      return sendError(res, 403, 'Invalid password');
    }
    const newPasshash = await hashPassword(validPassword);
    const newUser = await database.modifyUser(user.id, {
      passhash: newPasshash,
    });
    if (!newUser) {
      /* This should not happen IRL */
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    return sendReply(res, 204);
  })
);

router.put(
  '/me/language',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { language } = req.body;
    const validLanguage = validateLanguage(language);
    if (!validLanguage) {
      return sendError(res, 400, 'Invalid data');
    }
    const user = await database.modifyUser(uid, { language });
    if (!user) {
      /* This should not happen IRL */
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    return sendReply(res, 204);
  })
);

router.put(
  '/me/avatar',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { image } = req.body;
    let newAvatar = null;
    if (image) {
      newAvatar = await filestore.copyUploadToImages(image);
      if (!newAvatar) {
        return sendError(res, 404, 'Not found');
      }
    }
    const user = await database.modifyUser(uid, { avatar: newAvatar });
    if (!user) {
      /* This should not happen IRL */
      await filestore.deleteImage(newAvatar).catch(() => {});
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    if (user.old_avatar) {
      await filestore.deleteImage(user.old_avatar).catch(() => {});
    }
    let avatar = null;
    if (user.avatar) {
      [avatar] = await filestore.getImageURLs([user.avatar]);
    }
    return sendReply(res, 200, { avatar });
  })
);

router.post(
  '/me/endpoint',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { id, expires } = await reqstore.createEndpointRequest({
      userId: uid,
    });
    return sendReply(res, 201, { id, expires });
  })
);

router.post(
  '/images',
  sesmw,
  asyncmw(async (req, res) => {
    const image = await filestore.putUploadURL();
    return sendReply(res, 201, image);
  })
);

router.delete(
  '/images/:id',
  sesmw,
  asyncmw(async (req, res) => {
    const { id } = req.params;
    await filestore.deleteUpload(id);
    return sendReply(res, 204);
  })
);

router.post(
  '/images/url',
  sesmw,
  asyncmw(async (req, res) => {
    const images = req.body;
    if (!Array.isArray(images) || !images.every(filestore.isValidFileId)) {
      return sendError(res, 400, 'Invalid data');
    }
    const urls = await filestore.getImageURLs(images);
    return sendReply(res, 200, urls);
  })
);

router.get(
  '/users',
  sesmw,
  asyncmw(async (req, res) => {
    const { email } = req.query;
    const validEmail = validateEmail(email);
    if (!validEmail) {
      return sendError(res, 400, 'Invalid data');
    }
    const user = await database.findUser(validEmail);
    return sendReply(
      res,
      200,
      user
        ? [
            {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              avatar: user.avatar,
            },
          ]
        : []
    );
  })
);

router.post(
  '/users/batch',
  sesmw,
  asyncmw(async (req, res) => {
    const ids = req.body;
    if (!Array.isArray(ids) || !database.isValidLimit(ids.length)) {
      return sendError(res, 400, 'Invalid data');
    }
    const users = await database.getUsers(ids);
    return sendReply(
      res,
      200,
      users.map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
  })
);

router.get(
  '/users/friends',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { exclusiveStartIndex = 0, limit = queryLimit } = req.query;
    if (!database.isValidIndexAndLimit(exclusiveStartIndex, limit)) {
      return sendError(res, 400, 'Invalid data');
    }
    const connections = await database.getConnections(
      uid,
      Number(exclusiveStartIndex),
      Number(limit)
    );
    return sendReply(
      res,
      200,
      connections.map(u => ({
        index: u.index,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
  })
);

router.get(
  '/users/blocked',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { exclusiveStartIndex = 0, limit = queryLimit } = req.query;
    if (!database.isValidIndexAndLimit(exclusiveStartIndex, limit)) {
      return sendError(res, 400, 'Invalid data');
    }
    const blocked = await database.getBlocked(
      uid,
      Number(exclusiveStartIndex),
      Number(limit)
    );
    return sendReply(
      res,
      200,
      blocked.map(u => ({
        index: u.index,
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }))
    );
  })
);

router.put(
  '/users/:id/blocked',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { id } = req.params;
    const { blocked } = req.body;
    let r;
    if (blocked) {
      r = await database.addBlocked(uid, id);
    } else {
      r = await database.deleteBlocked(uid, id);
    }
    if (!r) {
      return sendError(res, 404, 'Not found');
    }
    return sendReply(res, 204);
  })
);

router.put(
  '/users/:id/unfriend',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { id } = req.params;
    const r = await database.deleteConnection(uid, id);
    if (!r) {
      return sendError(res, 404, 'Not found');
    }
    return sendReply(res, 204);
  })
);

router.post(
  '/users/invite',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { email } = req.body;
    const validEmail = validateEmail(email);
    if (!validEmail) {
      return sendError(res, 400, 'Invalid data');
    }
    const inviter = await database.getUser(uid);
    if (!inviter) {
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    if (await database.isIgnored(validEmail)) {
      return sendError(res, 409, 'Do not disturb');
    }
    const i = await database.addInvite(validEmail);
    if (!i) {
      return sendError(res, 409, 'Already invited');
    }
    const { user, invite } = i;
    if (invite) {
      await emailer.invitation({
        id: invite.id,
        email: user.email,
        firstName: inviter.firstName,
        lastName: inviter.lastName,
      });
    }
    return sendReply(res, 202, { id: user.id });
  })
);

router.post(
  '/postcards',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { receiver, image, message, location } = req.body;
    const [s, r] = await database.getUsers([uid, receiver]);
    if (!s || s.id !== uid) {
      await endSession(req).catch(() => {});
      return sendError(res, 409, 'User not found');
    }
    if (!r) {
      return sendError(res, 400, 'Invalid data');
    }
    if (await database.isBlocked(r.id, s.id)) {
      return sendError(res, 403, 'Blocked');
    }
    const i = await filestore.copyUploadToImages(image);
    if (!i) {
      return sendError(res, 400, 'Invalid data');
    }
    const { id } = await database.addPostcard({
      sender: s.id,
      receiver: r.id,
      message,
      image: i,
      location,
    });
    publisher.postcardReceived(r.id, id).catch(() => {});
    return sendReply(res, 201, { id });
  })
);

router.post(
  '/postcards/batch',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const ids = req.body;
    if (!Array.isArray(ids) || !database.isValidLimit(ids.length)) {
      return sendError(res, 400, 'Invalid data');
    }
    const postcards = await database.getPostcards(uid, ids);
    return sendReply(
      res,
      200,
      postcards.map(p => ({
        id: p.id,
        sender: p.sender,
        receiver: p.receiver,
        image: p.image,
        message: p.message,
        location: p.location,
        created: p.created,
        read: p.read,
      }))
    );
  })
);

router.post(
  '/postcards/batch-read',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const ids = req.body;
    if (!Array.isArray(ids) || !database.isValidLimit(ids.length)) {
      return sendError(res, 400, 'Invalid data');
    }
    const postcards = await database.getPostcards(uid, ids);
    return sendReply(
      res,
      200,
      postcards.map(p => ({
        id: p.id,
        read: p.read,
      }))
    );
  })
);

router.get(
  '/postcards/inbox',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { exclusiveStartIndex = 0, limit = queryLimit } = req.query;
    if (!database.isValidIndexAndLimit(exclusiveStartIndex, limit)) {
      return sendError(res, 400, 'Invalid data');
    }
    const inbox = await database.getInbox(
      uid,
      Number(exclusiveStartIndex),
      Number(limit)
    );
    return sendReply(
      res,
      200,
      inbox.map(i => ({ index: i.index, postcard: i.postcard }))
    );
  })
);

router.delete(
  '/postcards/inbox/:index',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { index } = req.params;
    const p = await database.removeFromInbox(uid, index);
    if (!p) {
      return sendError(res, 404, 'Not found');
    }
    return sendReply(res, 204);
  })
);

router.put(
  '/postcards/:id/read',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { id } = req.params;
    const p = await database.setAsRead(uid, id);
    if (!p) {
      return sendError(res, 404, 'Not found');
    }
    publisher.postcardDelivered(p.sender, p.id).catch(() => {});
    return sendReply(res, 204);
  })
);

router.post(
  '/postcards/:id/connect',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { id } = req.params;
    const r = await database.connectWithSender(uid, id);
    if (!r) {
      return sendError(res, 404, 'Not found');
    }
    const { user, sender } = r;
    publisher.setAsFriend(sender, user).catch(() => {});
    return sendReply(res, 204);
  })
);

router.get(
  '/postcards/sent',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { exclusiveStartIndex = 0, limit = queryLimit } = req.query;
    if (!database.isValidIndexAndLimit(exclusiveStartIndex, limit)) {
      return sendError(res, 400, 'Invalid data');
    }
    const sent = await database.getSent(
      uid,
      Number(exclusiveStartIndex),
      Number(limit)
    );
    return sendReply(
      res,
      200,
      sent.map(s => ({
        index: s.index,
        postcard: s.postcard,
      }))
    );
  })
);

router.delete(
  '/postcards/sent/:index',
  sesmw,
  asyncmw(async (req, res) => {
    const uid = reqUser(req);
    const { index } = req.params;
    const p = await database.removeFromSent(uid, index);
    if (!p) {
      return sendError(res, 404, 'Not found');
    }
    return sendReply(res, 204);
  })
);

module.exports = router;
