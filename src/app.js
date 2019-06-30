/*
 *
 */
const express = require('express');
const cors = require('cors');

const database = require('./database');
const filestore = require('./filestore');
const kvstore = require('./kvstore');
const publisher = require('./publisher');
const apiv1 = require('./api-v1');
const apiutils = require('./apiutils');
const logger = require('./logger');
const config = require('./config');

const { sendError } = apiutils;

async function initialize() {
  logger.info('app.initialize');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await Promise.all([
        database.initialize(),
        filestore.initialize(),
        kvstore.initialize(),
        publisher.initialize(),
      ]);
      break;
    } catch (e) {
      /* ignore error */
    }
    await new Promise(resolve =>
      setTimeout(resolve, config.reconnectionDelayMillis)
    );
  }

  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(logger.httpLogger);

  app.use('/v1', apiv1);

  if (process.env.NODE_ENV !== 'production') {
    apiv1.use('/dev', require('./devapi-v1')); /* eslint-disable-line */
  }

  /* handle missing routes */
  // eslint-disable-next-line no-unused-vars
  app.use((req, res, next) => {
    sendError(res, 404, 'Not found');
  });

  /* handle unexpected errors */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    /* log error details; do not leak error details to outside */
    if (err.status === 400) {
      /* 400 status from bodyparser; invalid JSON */
      return sendError(res, 400, 'Invalid data');
    }
    logger.error(`Server error: ${err}\n${err.stack}`);
    return sendError(res, 500, 'Internal service error');
  });

  return app;
}

async function shutdown() {
  logger.info('app.shutdown');
  try {
    await Promise.all([
      publisher.shutdown(),
      kvstore.shutdown(),
      filestore.shutdown(),
      database.shutdown(),
    ]);
  } catch (e) {
    /* ignore error */
  }
}

module.exports = { initialize, shutdown };
