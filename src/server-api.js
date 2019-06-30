/*
 *
 */
const app = require('./app');
const config = require('./config');
const logger = require('./logger');

const { apiPort } = config;

let httpServer; // eslint-disable-line no-unused-vars

process.on('SIGTERM', async () => {
  await app.shutdown().catch(() => {});
  process.exit(0);
});

(async () => {
  logger.info('starting server-api');

  /* ignore error; assume service is simply restarted if it fails to start */
  httpServer = (await app.initialize()).listen(apiPort, () => {
    logger.info(
      `server-api (${process.env.NODE_ENV}) started, listening port ${apiPort}`
    );
  });
})();
