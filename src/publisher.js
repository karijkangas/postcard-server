/*
 *
 */
const queue = require('./queue');
const subscriber = require('./subscriber');

const { createMessage, createLogoutMessage } = subscriber;

let publisher;

async function initialize() {
  if (!publisher) {
    publisher = await queue.createPublisher();
  }
}

async function shutdown() {
  const p = publisher;
  publisher = undefined;
  await p.close();
}

function postcardReceived(user, id) {
  return publisher.publish(
    createMessage(user, { type: 'postcard-received', id })
  );
}

function postcardDelivered(user, id) {
  return publisher.publish(
    createMessage(user, { type: 'postcard-delivered', id })
  );
}

function setAsFriend(user, id) {
  return publisher.publish(createMessage(user, { type: 'set-as-friend', id }));
}

function logout(user) {
  return publisher.publish(createLogoutMessage(user));
}

module.exports = {
  initialize,
  shutdown,
  postcardReceived,
  postcardDelivered,
  setAsFriend,
  logout,
};
