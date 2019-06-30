/*
 *
 */
const queue = require('./queue');
const logger = require('./logger');

let subscriber;
const registry = {};
const LOGOUT_TYPE = 'LOGOUT';

function relay(message) {
  const { userId, data } = JSON.parse(message);
  const ws = registry[userId];
  if (ws) {
    if (data.type === LOGOUT_TYPE) {
      ws.close();
    } else {
      ws.send(JSON.stringify(data));
    }
  }
}

async function initialize() {
  if (!subscriber) {
    subscriber = await queue.subscribe(relay);
  }
}

async function shutdown() {
  const s = subscriber;
  subscriber = undefined;
  await s();
}

function subscribe(userId, ws) {
  logger.info(`subscriber.subscribe: ${userId}`);
  const current = registry[userId];
  if (current) {
    current.close();
  }
  registry[userId] = ws;
  ws.on('close', () => {
    logger.info(`subscriber ws close: ${userId}`);
    if (registry[userId] === ws) {
      delete registry[userId];
    }
  });
}

function createMessage(userId, data) {
  return JSON.stringify({ userId, data });
}

function createLogoutMessage(userId) {
  return createMessage(userId, { type: LOGOUT_TYPE });
}

module.exports = {
  initialize,
  shutdown,
  subscribe,
  createMessage,
  createLogoutMessage,
};
