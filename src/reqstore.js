/*
 *
 */
const kvstore = require('./kvstore');
const utils = require('./utils');
const config = require('./config');

const { createId, isValidId } = utils;
const { requestTag, requestTtlMillis } = config;

const REGISTRATION = 'REGISTRATION';
const PASSWORD_RESET = 'PASSWORD_RESET';
const EMAIL_CHANGE = 'EMAIL_CHANGE';
const ENDPOINT = 'ENDPOINT';

function typeKey(type) {
  return `${requestTag}_${type}`;
}

function key(type, id) {
  return `${typeKey(type)}:${id}`;
}

async function create(type, data) {
  const id = createId();
  const expires = Date.now() + requestTtlMillis;
  await kvstore.set(key(type, id), JSON.stringify(data), requestTtlMillis);
  return { id, expires };
}

async function resolve(type, id) {
  if (!isValidId(id)) {
    return undefined;
  }
  const data = await kvstore.remove(key(type, id));
  return (data && JSON.parse(data)) || undefined;
}

async function createRegistrationRequest(data) {
  return create(REGISTRATION, data);
}

async function resolveRegistrationRequest(id) {
  return resolve(REGISTRATION, id);
}

async function createPasswordResetRequest(data) {
  return create(PASSWORD_RESET, data);
}

async function resolvePasswordResetRequest(id) {
  return resolve(PASSWORD_RESET, id);
}

async function createEmailChangeRequest(data) {
  return create(EMAIL_CHANGE, data);
}

async function resolveEmailChangeRequest(id) {
  return resolve(EMAIL_CHANGE, id);
}

async function createEndpointRequest(data) {
  return create(ENDPOINT, data);
}

async function resolveEndpointRequest(id) {
  return resolve(ENDPOINT, id);
}

module.exports = {
  createRegistrationRequest,
  resolveRegistrationRequest,
  createPasswordResetRequest,
  resolvePasswordResetRequest,
  createEmailChangeRequest,
  resolveEmailChangeRequest,
  createEndpointRequest,
  resolveEndpointRequest,
};

/* ------------------------------------------------------------------ */
/* eslint-disable no-inner-declarations */
if (process.env.NODE_ENV !== 'production') {
  async function devPending(type) {
    const keys = await kvstore.keys(key(type, '*'));
    return keys.map(k => k.split(':')[1]);
  }

  async function devPendingRegistrationRequests() {
    return devPending(REGISTRATION);
  }

  async function devPendingPasswordResetRequests() {
    return devPending(PASSWORD_RESET);
  }

  async function devPendingEmailChangeRequests() {
    return devPending(EMAIL_CHANGE);
  }

  async function devPendingEndpointRequests() {
    return devPending(ENDPOINT);
  }

  async function devClearRequests() {
    await kvstore.delPattern(typeKey('*'));
  }

  module.exports = {
    ...module.exports,
    devPendingRegistrationRequests,
    devPendingPasswordResetRequests,
    devPendingEmailChangeRequests,
    devPendingEndpointRequests,
    devClearRequests,
  };
}
