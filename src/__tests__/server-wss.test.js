/*
 *
 */
/* eslint-disable global-require */
jest.mock('ws');

jest.mock('../kvstore');
jest.mock('../reqstore');
jest.mock('../subscriber');

jest.mock('../config');
jest.mock('../logger');

let kvstore;
let reqstore;
let Subscriber;

let config;
let logger;

const processOn = jest.spyOn(process, 'on').mockImplementation(() => {});
const processExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

const { resolvePromises } = require('./util');

let WebSocket;
// const WebSocket = require('ws');

describe('server-wss.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    kvstore = require('../kvstore');
    reqstore = require('../reqstore');
    Subscriber = require('../subscriber');

    config = require('../config');
    config.wssPort = '1234';
    config.connectionRetryDelay = 1234;
    config.pingIntervalMillis = 2345;

    logger = require('../logger');

    process.env.NODE_ENV = 'production';
    kvstore = require('../kvstore');

    WebSocket = require('ws');
  });

  test('starting server should work', async done => {
    kvstore.initialize.mockResolvedValue();
    kvstore.shutdown.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    Subscriber.shutdown.mockResolvedValue();

    const wss = await require('../server-wss');

    expect(processOn).toHaveBeenNthCalledWith(
      1,
      'SIGTERM',
      expect.any(Function)
    );

    await processOn.mock.calls[0][1]();

    expect(Subscriber.shutdown).toBeCalledTimes(1);
    expect(kvstore.shutdown).toBeCalledTimes(1);
    expect(processExit).toBeCalledWith(0);

    kvstore.shutdown.mockRejectedValue(new Error('TEST'));
    Subscriber.shutdown.mockRejectedValue(new Error('TEST'));
    await processOn.mock.calls[0][1]();

    wss.close(done);
  });
  test('starting server loops until success', async done => {
    kvstore.initialize.mockResolvedValue();
    kvstore.initialize.mockRejectedValueOnce(new Error('TEST'));
    Subscriber.initialize.mockResolvedValue();
    Subscriber.initialize.mockRejectedValueOnce(new Error('TEST'));
    Subscriber.initialize.mockRejectedValueOnce(new Error('TEST'));

    const p = require('../server-wss');
    await resolvePromises();
    jest.runAllTimers();
    await resolvePromises();

    jest.runAllTimers();
    await resolvePromises();

    const wss = await p;

    expect(setTimeout).toBeCalledTimes(2);
    expect(setTimeout).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      config.connectionRetryDelay
    );
    expect(setTimeout).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      config.connectionRetryDelay
    );

    wss.close(done);
  });
  test('/v1/endpoints/{id} connection should work', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    const ep = { userId: 'userId' };
    reqstore.resolveEndpointRequest.mockResolvedValue(ep);

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    const s = await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.on('open', () => {
        resolve(ws);
      });
      ws.on('error', event => {
        reject(event);
      });
    });
    s.close();

    wss.close(done);
  });
  test('/v1/endpoints/{id} should reject invalid endpoint', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    reqstore.resolveEndpointRequest.mockResolvedValue(undefined);

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(endpoint);
        ws.on('open', () => {
          resolve(ws);
        });
        ws.on('error', event => {
          reject(event);
        });
      })
    ).rejects.toThrow();

    wss.close(done);
  });
  test('/v1/endpoints/{id} should reject connections on registry failure', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    reqstore.resolveEndpointRequest.mockRejectedValueOnce(new Error('TEST'));

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(endpoint);
        ws.on('open', () => {
          resolve(ws);
        });
        ws.on('error', event => {
          reject(event);
        });
      })
    ).rejects.toThrow();

    wss.close(done);
  });
  test('/v1/endpoints/{id} close connection on subscriber failure', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    const ep = { userId: 'userId' };
    reqstore.resolveEndpointRequest.mockResolvedValue(ep);
    Subscriber.subscribe.mockImplementation(() => {
      throw new Error('TEST');
    });

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    const s = await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.on('open', () => {
        resolve(ws);
      });
      ws.on('error', event => {
        reject(event);
      });
    });
    await new Promise(resolve => {
      s.on('close', resolve);
    });

    wss.close(done);
  });
  test('/v1/endpoints/{id} should reject invalid connections', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    reqstore.resolveEndpointRequest.mockRejectedValueOnce(new Error('TEST'));

    const endpoint = `ws://localhost:${config.wssPort}/invalid`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(endpoint);
        ws.on('open', () => {
          resolve(ws);
        });
        ws.on('error', event => {
          reject(event);
        });
      })
    ).rejects.toThrow();

    wss.close(done);
  });
  test('/v1/healthz connection should work', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();

    const endpoint = `ws://localhost:${config.wssPort}/healthz`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.on('open', () => {
        resolve(ws);
      });
      ws.on('error', event => {
        reject(event);
      });
    });

    wss.close(done);
  });
  test('connection should respond to ping', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    const ep = { userId: 'userId' };
    reqstore.resolveEndpointRequest.mockResolvedValue(ep);

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    const s = await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.on('open', () => {
        resolve(ws);
      });
      ws.on('error', event => {
        reject(event);
      });
    });

    const p = new Promise(resolve => {
      s.on('pong', () => {
        resolve();
      });
    });

    s.ping();
    await p;
    s.close();

    wss.close(done);
  });
  test('connection should echo messages', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    const ep = { userId: 'userId' };
    reqstore.resolveEndpointRequest.mockResolvedValue(ep);

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    const s = await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.on('open', () => {
        resolve(ws);
      });
      ws.on('error', event => {
        reject(event);
      });
    });

    const p = new Promise(resolve => {
      s.on('message', data => {
        resolve(data);
      });
    });

    const data = 'HELLO';
    s.send(data);
    expect(await p).toEqual(data);

    s.close();

    wss.close(done);
  });
  test('connection should use heartbeat', async done => {
    kvstore.initialize.mockResolvedValue();
    Subscriber.initialize.mockResolvedValue();
    const ep = { userId: 'userId' };
    reqstore.resolveEndpointRequest.mockResolvedValue(ep);

    const id = '4321';
    const endpoint = `ws://localhost:${config.wssPort}/v1/endpoints/${id}`;
    const wss = await require('../server-wss');

    // const WebSocket = require('ws');
    const s = await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint);
      ws.on('open', () => {
        resolve(ws);
      });
      ws.on('error', event => {
        reject(event);
      });
    });

    // ping-pong 10 times
    let counter = 10;
    await new Promise(resolve => {
      function f() {
        counter -= 1;
        if (counter <= 0) {
          s.removeEventListener('ping', f);
          resolve();
        } else {
          setImmediate(() => {
            // setImmediate lets ws.on('pong') to run
            jest.runOnlyPendingTimers();
          });
        }
      }
      s.on('ping', f);
      jest.runOnlyPendingTimers();
    });

    // let the connection timeout
    await new Promise(resolve => {
      s.on('close', resolve);
      s.on('ping', () => {
        // jest.runOnlyPendingTimers will not let ws.on('pong') to run
        jest.runOnlyPendingTimers();
      });
      jest.runOnlyPendingTimers();
    });

    wss.close(done);
  });
});
