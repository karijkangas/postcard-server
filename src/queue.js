/*
 *
 */
const redis = require('redis');
const { promisify } = require('util');

const logger = require('./logger');
const config = require('./config');

const { eventsChannel } = config;

function unsubscribe(client) {
  logger.info('queue unsubscribe');
  return new Promise((resolve, reject) => {
    try {
      client.quit(resolve);
    } catch (e) {
      logger.info(`unsubscribe error: ${e}`);
      reject(e);
    }
  });
}

function subscribe(callback) {
  logger.info('queue subscribe');
  return new Promise((resolve, reject) => {
    const opts = { ...config.redis, enable_offline_queue: false };
    try {
      const client = redis.createClient(opts);
      client.on('error', err => {
        logger.error(`queue subscribe error: ${err}`);
      });
      client.on('ready', () => {
        logger.info('queue subscribe ready');
        client.subscribe(eventsChannel);
        resolve(() => {
          return unsubscribe(client);
        });
      });
      client.on('message', (channel, message) => {
        try {
          callback(message);
        } catch (e) {
          logger.error(`queue subscribe message exception: ${e}\n${e.stack}`);
        }
      });
    } catch (e) {
      logger.error(`queue subscribe failed: ${e}`);
      reject(e);
    }
  });
}

function shutdown(client) {
  logger.info('queue publisher shutdown');
  return new Promise((resolve, reject) => {
    try {
      client.quit(resolve);
    } catch (e) {
      logger.info(`queue publisher shutdown error: ${e}`);
      reject(e);
    }
  });
}

function createPublisher() {
  logger.info('queue create publisher');
  return new Promise((resolve, reject) => {
    const opts = { ...config.redis, enable_offline_queue: false };
    try {
      const client = redis.createClient(opts);
      const bound = {
        publish: promisify(client.publish).bind(client, eventsChannel),
        close: () => shutdown(client),
      };
      client.on('error', err => {
        logger.error(`queue publisher error: ${err}`);
      });
      client.on('ready', () => {
        logger.info('queue publisher ready');
        resolve(bound);
      });
    } catch (e) {
      logger.error(`queue initialize  failed: ${e}`);
      reject(e);
    }
  });
}

module.exports = {
  subscribe,
  createPublisher,
};
