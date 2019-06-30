/*
 *
 */
const WebSocket = require('ws');

const kvstore = require('./kvstore');
const reqstore = require('./reqstore');
const subscriber = require('./subscriber');

const config = require('./config');
const logger = require('./logger');

const { wssPort, connectionRetryDelay, pingIntervalMillis } = config;

const endpointsRE = /^\/v1\/endpoints\/(.+)$/;
const healthzRE = /^\/healthz/;

process.on('SIGTERM', async () => {
  await Promise.all([
    subscriber.shutdown().catch(() => {}),
    kvstore.shutdown().catch(() => {}),
  ]);

  process.exit(0);
});

module.exports = (async () => {
  logger.info('starting server-endpoints');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await Promise.all([kvstore.initialize(), subscriber.initialize()]);
      break;
    } catch (e) {
      /* ignore error */
    }
    await new Promise(resolve => setTimeout(resolve, connectionRetryDelay));
  }

  const wss = new WebSocket.Server({
    port: wssPort,
    verifyClient: async ({ req }, done) => {
      try {
        const m = req.url.match(endpointsRE);
        if (m && m[1]) {
          const r = await reqstore.resolveEndpointRequest(m[1]);
          if (r) {
            req.userId = r.userId;
            return done(true);
          }
        } else if (req.url.match(healthzRE)) {
          req.userId = 0;
          return done(true);
        }
      } catch (e) {
        logger.error(`server-wss verifyClient exception: ${e}`);
      }
      logger.info(`server-wss refused connection to ${req.url}`);
      return done(false, 404, 'Not found');
    },
  });

  wss.on('connection', async (ws, req) => {
    try {
      const { userId } = req;
      if (userId) {
        subscriber.subscribe(userId, ws);
      }

      let counter = 0;
      const interval = setInterval(() => {
        if (counter >= 2) {
          clearInterval(interval);
          ws.close();
        } else {
          counter += 1;
          ws.ping();
        }
      }, pingIntervalMillis);

      ws.on('close', () => {
        clearInterval(interval);
      });

      ws.on('pong', () => {
        counter = 0;
      });

      ws.on('message', data => {
        counter = 0;
        ws.send(data);
      });
    } catch (e) {
      logger.error(`server-wss connection exception: ${e}`);
      ws.close();
    }
  });

  logger.info(`server-wss started, listening port ${wssPort}`);
  return wss;
})();
