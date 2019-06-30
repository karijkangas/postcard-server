/*
 *
 */
const redis = require('redis');
const { promisify } = require('util');

const logger = require('./logger');
const config = require('./config');

let client;

function initialize() {
  logger.info('kvstore initialize');
  if (client) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    try {
      const opts = { ...config.redis, enable_offline_queue: false };
      client = redis.createClient(opts);
      client.on('error', err => {
        logger.error(`kvstore error: ${err}`);
      });
      client.on('ready', () => {
        logger.info('kvstore ready');
        resolve();
      });
    } catch (e) {
      logger.error(`kvstore initialize error: ${e}`);
      client = undefined;
      reject(e);
    }
  });
}

function shutdown() {
  logger.info('kvstore shutdown');
  if (!client) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    try {
      const c = client;
      client = undefined;
      c.quit(resolve);
    } catch (e) {
      logger.info(`kvstore shutdown error: ${e}`);
      resolve();
    }
  });
}

function set(key, value, ttlMillis) {
  const clientSet = promisify(client.set).bind(client);
  return clientSet(key, value, 'EX', ttlMillis / 1000);
}

function get(key) {
  const clientGet = promisify(client.get).bind(client);
  return clientGet(key);
}

async function remove(key) {
  const data = await get(key);
  if (data) {
    await del(key); /* eslint-disable-line no-use-before-define */
  }
  return data;
}

function del(key) {
  const clientDel = promisify(client.del).bind(client);
  return clientDel(key);
}

function keys(pattern) {
  const clientKeys = promisify(client.keys).bind(client);
  return clientKeys(pattern);
}

function renew(key, ttlMillis) {
  const clientExpire = promisify(client.expire).bind(client);
  return clientExpire(key, ttlMillis / 1000);
}

async function delPattern(pattern) {
  const k = await keys(pattern);
  if (k.length !== 0) {
    for (let i = 0; i < k.length; i += 1) {
      await del(k[i]);
    }
  }
}

function publish(channel, message) {
  const clientPublish = promisify(client.publish).bind(client);
  return clientPublish(channel, message);
}

module.exports = {
  initialize,
  shutdown,
  set,
  get,
  remove,
  del,
  keys,
  renew,
  delPattern,
  publish,
};
