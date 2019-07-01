/*
 *
 */
/* eslint-disable global-require */
jest.mock('redis');

jest.mock('../config');
jest.mock('../logger');

let redis;

let config;
let logger; /* eslint-disable-line no-unused-vars */

let kvstore;

describe('kvstore.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    redis = require('redis');
    redis.createClient.mockClear();

    config = require('../config');
    config.redis = {
      key1: 'value1',
    };
    logger = require('../logger');

    process.env.NODE_ENV = 'production';
    kvstore = require('../kvstore');
  });

  describe('initialize and shutdown', () => {
    test('initialize and shutdown should work', async () => {
      const c = {
        on: jest.fn(),
        quit: jest.fn().mockImplementation(cb => cb()),
      };
      redis.createClient.mockReturnValue(c);
      const p = kvstore.initialize();

      expect(redis.createClient).toBeCalledTimes(1);
      expect(c.on).toBeCalledTimes(2);
      c.on.mock.calls[0][1](new Error('TEST'));
      c.on.mock.calls[1][1]();

      await p;
      await kvstore.initialize();
      expect(redis.createClient).toBeCalledTimes(1);

      await kvstore.shutdown();
      expect(c.quit).toBeCalledTimes(1);
      await kvstore.shutdown();
      expect(c.quit).toBeCalledTimes(1);
    });

    test('initialize should throw on unexpected error', async () => {
      const c = {
        on: jest.fn().mockImplementation(() => {
          throw new Error('TEST');
        }),
      };
      redis.createClient.mockReturnValue(c);
      const p = kvstore.initialize();

      expect(p).rejects.toThrow('TEST');
    });

    test('shutdown should ignore errors', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        quit: jest.fn().mockImplementation(() => {
          throw new Error('TEST');
        }),
      };
      redis.createClient.mockReturnValue(c);

      await kvstore.initialize();
      await kvstore.shutdown();
      expect(c.quit).toBeCalledTimes(1);
    });
  });

  describe('set', () => {
    test('set should work', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        set: jest.fn().mockImplementation((a, b, d, e, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      const value = 'value';
      const ttlMillis = 1234;
      await kvstore.set(key, value, ttlMillis);
      expect(c.set).toBeCalledTimes(1);
      expect(c.set).toHaveBeenNthCalledWith(
        1,
        key,
        value,
        'EX',
        ttlMillis / 1000,
        expect.any(Function)
      );
    });
    test('set should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        set: jest
          .fn()
          .mockImplementation((a, b, d, e, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      const value = 'value';
      const ttlMillis = 1234;
      await expect(kvstore.set(key, value, ttlMillis)).rejects.toThrow('TEST');
      expect(c.set).toBeCalledTimes(1);
    });
  });
  describe('get', () => {
    test('get should work', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        get: jest.fn().mockImplementation((a, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await kvstore.get(key);
      expect(c.get).toBeCalledTimes(1);
      expect(c.get).toHaveBeenNthCalledWith(1, key, expect.any(Function));
    });
    test('get should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        get: jest.fn().mockImplementation((a, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await expect(kvstore.get(key)).rejects.toThrow('TEST');
      expect(c.get).toBeCalledTimes(1);
    });
  });
  describe('remove', () => {
    test('remove should work', async () => {
      const value = 'value';
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        get: jest.fn().mockImplementation((a, cb) => cb(undefined, value)),
        del: jest.fn().mockImplementation((a, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await kvstore.remove(key);
      expect(c.get).toBeCalledTimes(1);
      expect(c.get).toHaveBeenNthCalledWith(1, key, expect.any(Function));
      expect(c.del).toBeCalledTimes(1);
      expect(c.del).toHaveBeenNthCalledWith(1, key, expect.any(Function));
    });
    test('remove should ignore not found value', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        get: jest.fn().mockImplementation((a, cb) => cb()),
        del: jest.fn(),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await kvstore.remove(key);
      expect(c.get).toBeCalledTimes(1);
      expect(c.get).toHaveBeenNthCalledWith(1, key, expect.any(Function));
      expect(c.del).not.toBeCalled();
    });
    test('remove should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        get: jest.fn().mockImplementation((a, cb) => cb(new Error('TEST'))),
        del: jest.fn(),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await expect(kvstore.remove(key)).rejects.toThrow('TEST');
      expect(c.get).toBeCalledTimes(1);
    });
  });
  describe('del', () => {
    test('del should work', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        del: jest.fn().mockImplementation((a, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await kvstore.del(key);
      expect(c.del).toBeCalledTimes(1);
      expect(c.del).toHaveBeenNthCalledWith(1, key, expect.any(Function));
    });
    test('del should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        del: jest.fn().mockImplementation((a, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      await expect(kvstore.del(key)).rejects.toThrow('TEST');
      expect(c.del).toBeCalledTimes(1);
    });
  });
  describe('keys', () => {
    test('keys should work', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        keys: jest.fn().mockImplementation((a, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const pattern = 'pattern';
      await kvstore.keys(pattern);
      expect(c.keys).toBeCalledTimes(1);
      expect(c.keys).toHaveBeenNthCalledWith(1, pattern, expect.any(Function));
    });
    test('keys should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        keys: jest.fn().mockImplementation((a, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const pattern = 'pattern';
      await expect(kvstore.keys(pattern)).rejects.toThrow('TEST');
      expect(c.keys).toBeCalledTimes(1);
    });
  });
  describe('renew', () => {
    test('renew should work', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        expire: jest.fn().mockImplementation((a, b, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      const ttlMillis = 1234;
      await kvstore.renew(key, ttlMillis);
      expect(c.expire).toBeCalledTimes(1);
      expect(c.expire).toHaveBeenNthCalledWith(
        1,
        key,
        ttlMillis / 1000,
        expect.any(Function)
      );
    });
    test('renew should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        expire: jest
          .fn()
          .mockImplementation((a, b, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const key = 'key';
      const ttlMillis = 1234;
      await expect(kvstore.renew(key, ttlMillis)).rejects.toThrow('TEST');
      expect(c.expire).toBeCalledTimes(1);
    });
  });
  describe('delPattern', () => {
    test('delPattern should work', async () => {
      const keys = ['key-1', 'key-2'];
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        keys: jest.fn().mockImplementation((a, cb) => cb(undefined, keys)),
        del: jest.fn().mockImplementation((a, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const pattern = 'pattern';
      await kvstore.delPattern(pattern);
      expect(c.keys).toBeCalledTimes(1);
      expect(c.keys).toHaveBeenNthCalledWith(1, pattern, expect.any(Function));
      expect(c.del).toBeCalledTimes(keys.length);
      for (let i = 0; i < keys.length; i += 1) {
        expect(c.del).toHaveBeenNthCalledWith(
          i + 1,
          keys[i],
          expect.any(Function)
        );
      }
    });
    test('delPattern should ignore not matching pattern', async () => {
      const keys = [];
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        keys: jest.fn().mockImplementation((a, cb) => cb(undefined, keys)),
        del: jest.fn(),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const pattern = 'pattern';
      await kvstore.delPattern(pattern);
      expect(c.keys).toBeCalledTimes(1);
      expect(c.keys).toHaveBeenNthCalledWith(1, pattern, expect.any(Function));
      expect(c.del).not.toBeCalled();
    });
    test('delPattern should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        keys: jest.fn().mockImplementation((a, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const pattern = 'pattern';
      await expect(kvstore.delPattern(pattern)).rejects.toThrow('TEST');
      expect(c.keys).toBeCalledTimes(1);
    });
  });
  describe('publish', () => {
    test('publish should work', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        publish: jest.fn().mockImplementation((a, b, cb) => cb()),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const channel = 'channel';
      const message = 'message';
      await kvstore.publish(channel, message);
      expect(c.publish).toBeCalledTimes(1);
      expect(c.publish).toHaveBeenNthCalledWith(
        1,
        channel,
        message,
        expect.any(Function)
      );
    });
    test('publish should throw on kvstore failure', async () => {
      const c = {
        on: jest.fn().mockImplementation((message, cb) => {
          if (message === 'ready') {
            cb();
          }
        }),
        publish: jest
          .fn()
          .mockImplementation((a, b, cb) => cb(new Error('TEST'))),
      };
      redis.createClient.mockReturnValue(c);
      await kvstore.initialize();

      const channel = 'channel';
      const message = 'message';
      await expect(kvstore.publish(channel, message)).rejects.toThrow('TEST');
      expect(c.publish).toBeCalledTimes(1);
    });
  });
});
