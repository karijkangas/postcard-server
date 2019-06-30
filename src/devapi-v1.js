/*
 *
 */
const express = require('express');

const apiutils = require('./apiutils');
const sesstore = require('./sesstore');
const database = require('./database');
const filestore = require('./filestore');
const reqstore = require('./reqstore');

const router = express.Router();

router.post(
  '/users',
  apiutils.asyncmw(async (req, res) => {
    const { password } = req.body;
    const passhash = await apiutils.hashPassword(password);
    const user = await database.devAddUser({ ...req.body, passhash });
    if (!user) {
      return apiutils.sendError(res, 400, 'Invalid data');
    }
    return apiutils.sendReply(res, 201, user);
  })
);

router.get(
  '/users',
  apiutils.asyncmw(async (req, res) => {
    const { email } = req.query;
    let users;
    if (email) {
      users = [await database.findUser(email)];
    } else {
      users = await database.devGetUsers();
    }
    return apiutils.sendReply(res, 200, users);
  })
);

router.post(
  '/users/friends',
  apiutils.asyncmw(async (req, res) => {
    const { user, friend } = req.body;
    const c = await database.devAddConnection(user, friend);
    if (!c) {
      return apiutils.sendError(res, 400, 'Invalid data');
    }
    return apiutils.sendReply(res, 201, c);
  })
);

router.post(
  '/users/friends/clear',
  apiutils.asyncmw(async (req, res) => {
    await database.devClearConnections();
    return apiutils.sendReply(res, 204);
  })
);

router.post(
  '/users/blocked/clear',
  apiutils.asyncmw(async (req, res) => {
    await database.devClearBlocked();
    return apiutils.sendReply(res, 204);
  })
);

router.delete(
  '/users/:id',
  apiutils.asyncmw(async (req, res) => {
    const { id } = req.params;
    const user = await database.getUser(id);
    if (user) {
      if (user.avatar) {
        await filestore.deleteImage(user.avatar);
      }
      await database.deleteUser(id);
    }
    apiutils.sendReply(res, 204);
  })
);

router.post(
  '/users/clear',
  apiutils.asyncmw(async (req, res) => {
    await database.devClearUsers();
    return apiutils.sendReply(res, 204);
  })
);

router.get(
  '/sessions',
  apiutils.asyncmw(async (req, res) => {
    const sessions = await sesstore.devSessions();
    apiutils.sendReply(res, 200, sessions);
  })
);

router.post(
  '/sessions/clear',
  apiutils.asyncmw(async (req, res) => {
    await sesstore.devClearSessions();
    apiutils.sendReply(res, 204);
  })
);

router.get(
  '/registrations',
  apiutils.asyncmw(async (req, res) => {
    const pending = await reqstore.devPendingRegistrationRequests();
    apiutils.sendReply(res, 200, pending);
  })
);

router.get(
  '/password_resets',
  apiutils.asyncmw(async (req, res) => {
    const pending = await reqstore.devPendingPasswordResetRequests();
    apiutils.sendReply(res, 200, pending);
  })
);

router.get(
  '/email_changes',
  apiutils.asyncmw(async (req, res) => {
    const pending = await reqstore.devPendingEmailChangeRequests();
    apiutils.sendReply(res, 200, pending);
  })
);

router.get(
  '/endpoints',
  apiutils.asyncmw(async (req, res) => {
    const pending = await reqstore.devPendingEndpointRequests();
    apiutils.sendReply(res, 200, pending);
  })
);

router.post(
  '/requests/clear',
  apiutils.asyncmw(async (req, res) => {
    await reqstore.devClearRequests();
    apiutils.sendReply(res, 204);
  })
);

router.get(
  '/invites',
  apiutils.asyncmw(async (req, res) => {
    const pending = await database.devGetInvites();
    apiutils.sendReply(res, 200, pending.map(p => p.id));
  })
);

router.post(
  '/invites/clear',
  apiutils.asyncmw(async (req, res) => {
    await database.devClearInvites();
    return apiutils.sendReply(res, 204);
  })
);

router.get(
  '/ignored',
  apiutils.asyncmw(async (req, res) => {
    const ignored = await database.devGetIgnored();
    apiutils.sendReply(res, 200, ignored.map(i => i.hash));
  })
);

router.post(
  '/ignored',
  apiutils.asyncmw(async (req, res) => {
    const { email } = req.body;
    await database.ignore(email);
    return apiutils.sendReply(res, 204);
  })
);

router.post(
  '/ignored/clear',
  apiutils.asyncmw(async (req, res) => {
    await database.devClearIgnored();
    apiutils.sendReply(res, 204);
  })
);

router.get(
  '/uploads',
  apiutils.asyncmw(async (req, res) => {
    const images = await filestore.devGetUploads();
    apiutils.sendReply(res, 200, images);
  })
);

router.post(
  '/uploads/clear',
  apiutils.asyncmw(async (req, res) => {
    await filestore.devClearUploads();
    apiutils.sendReply(res, 204);
  })
);

router.get(
  '/images',
  apiutils.asyncmw(async (req, res) => {
    const images = await filestore.devGetImages();
    apiutils.sendReply(res, 200, images);
  })
);

router.post(
  '/images/clear',
  apiutils.asyncmw(async (req, res) => {
    await filestore.devClearImages();
    apiutils.sendReply(res, 204);
  })
);

router.get(
  '/postcards',
  apiutils.asyncmw(async (req, res) => {
    const postcards = await database.devGetPostcards();
    apiutils.sendReply(res, 200, postcards);
  })
);

router.post(
  '/postcards/clear',
  apiutils.asyncmw(async (req, res) => {
    const postcards = await database.devGetPostcards();
    for (let i = 0; i < postcards.length; i += 1) {
      const { image } = await database.deletePostcard(postcards[i].id);
      await filestore.deleteImage(image);
    }
    apiutils.sendReply(res, 204);
  })
);

router.delete(
  '/postcards/:id',
  apiutils.asyncmw(async (req, res) => {
    const { id } = req.params;
    const { image } = await database.deletePostcard(id);
    await filestore.deleteImage(image);
    apiutils.sendReply(res, 204);
  })
);

router.post(
  '/RESET',
  apiutils.asyncmw(async (req, res) => {
    await sesstore.devClearSessions();
    await reqstore.devClearRequests();
    await database.devClearUsers();
    await database.devClearConnections();
    await database.devClearBlocked();
    await database.devClearInvites();
    await database.devClearIgnored();
    await filestore.devClearUploads();
    await filestore.devClearImages();
    await database.devClearPostcards();
    return apiutils.sendReply(res, 204);
  })
);

module.exports = router;
