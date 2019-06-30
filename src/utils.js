/*
 *
 */
const fs = require('fs');
const uuidv4 = require('uuid/v4');
const crypto = require('crypto');

const v4 = new RegExp(
  /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
);

function createId() {
  return uuidv4();
}

function isValidId(id) {
  return id && typeof id === 'string' && id.match(v4);
}

function inRange(x, a, b) {
  return x >= a && x <= b;
}

function envInt(k) {
  const n = Number(process.env[k]);
  return Number.isNaN(n) ? undefined : n;
}

function envBool(k) {
  switch (process.env[k]) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      return undefined;
  }
}

function fileString(f) {
  try {
    return fs.readFileSync(f, { encoding: 'utf8' });
  } catch (e) {
    return undefined;
  }
}

function definedKeys(obj) {
  const newObj = {};
  Object.keys(obj).forEach(k => {
    if (obj[k] !== undefined) {
      newObj[k] = obj[k];
    }
  });
  return newObj;
}

function changeHost(url, newHost) {
  const u = new URL(url);
  u.host = newHost;
  return u.toString();
}

function hash(s) {
  const h = crypto.createHash('sha256');
  return h.update(s).digest('hex');
}

function emailHash(email) {
  return hash(email.toLowerCase());
}

module.exports = {
  createId,
  isValidId,
  inRange,
  envInt,
  envBool,
  fileString,
  definedKeys,
  changeHost,
  hash,
  emailHash,
};
