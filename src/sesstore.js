/*
 *
 */
const utils = require('./utils');
const config = require('./config');
const kvstore = require('./kvstore');

const { createId, isValidId } = utils;
const { sessionTag, sessionTtlMillis } = config;

function key(token) {
  return `${sessionTag}:${token}`;
}

async function startSession(data) {
  const token = createId();
  const expires = Date.now() + sessionTtlMillis;
  await kvstore.set(key(token), JSON.stringify(data), sessionTtlMillis);
  return { token, expires };
}

async function sessionData({ token }) {
  if (!isValidId(token)) {
    return undefined;
  }
  const data = await kvstore.get(key(token));
  return (data && JSON.parse(data)) || undefined;
}

async function renewSession({ token }) {
  if (!isValidId(token)) {
    return undefined;
  }
  const expires = Date.now() + sessionTtlMillis;
  const s = await kvstore.renew(key(token), sessionTtlMillis);
  if (!s) {
    return undefined;
  }
  return { token, expires };
}

function endSession({ token }) {
  if (!isValidId(token)) {
    return undefined;
  }
  return kvstore.del(key(token));
}

module.exports = { startSession, sessionData, renewSession, endSession };

/* ------------------------------------------------------------------ */
/* eslint-disable no-inner-declarations */
if (process.env.NODE_ENV !== 'production') {
  async function devSessions() {
    const keys = await kvstore.keys(`${sessionTag}*`);
    return keys.map(k => k.split(':')[1]);
  }

  async function devClearSessions() {
    await kvstore.delPattern(`${sessionTag}*`);
  }

  module.exports = { ...module.exports, devSessions, devClearSessions };
}
