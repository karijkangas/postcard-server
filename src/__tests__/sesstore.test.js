/*
 *
 */
/* eslint-disable global-require */

jest.mock('../kvstore');
jest.mock('../utils');
jest.mock('../logger');
jest.mock('../config');

describe('session.js', () => {
  jest.resetModules();
  jest.useFakeTimers();

  const config = require('../config');
  config.sessionTag = 'session-tag';
  config.sessionTtlMillis = 1234;

  const kvstore = require('../kvstore');
  const utils = require('../utils');
  const sesstore = require('../sesstore');

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('startSession', () => {
    test('startSession should work', async () => {
      const token = 'token';
      utils.createId.mockReturnValue(token);
      kvstore.set.mockResolvedValue(true);

      const data = { key: 'value' };
      const r = await sesstore.startSession(data);

      expect(r.token).toEqual(token);
      expect(r.expires).toBeLessThanOrEqual(
        Date.now() + config.sessionTtlMillis
      );

      expect(utils.createId).toBeCalledTimes(1);

      expect(kvstore.set).toBeCalledTimes(1);
      expect(kvstore.set).toHaveBeenNthCalledWith(
        1,
        `${config.sessionTag}:${token}`,
        JSON.stringify(data),
        config.sessionTtlMillis
      );
    });

    test('startSession should throw on kvstore failure', async () => {
      const token = 'token';
      utils.createId.mockReturnValue(token);
      kvstore.set.mockRejectedValue(new Error('TEST'));

      const data = { key: 'value' };
      await expect(sesstore.startSession(data)).rejects.toThrow('TEST');

      expect(utils.createId).toBeCalledTimes(1);
      expect(kvstore.set).toBeCalledTimes(1);
    });
  });

  describe('sessionData', () => {
    test('sessionData should work', async () => {
      utils.isValidId.mockReturnValue(true);
      const data = { key: 'value' };
      kvstore.get.mockResolvedValue(JSON.stringify(data));

      const token = 'token';
      const r = await sesstore.sessionData({ token });

      expect(r).toEqual(data);

      expect(utils.isValidId).toBeCalledTimes(1);
      expect(utils.isValidId).toHaveBeenNthCalledWith(1, token);

      expect(kvstore.get).toBeCalledTimes(1);
      expect(kvstore.get).toHaveBeenNthCalledWith(
        1,
        `${config.sessionTag}:${token}`
      );
    });
    test('sessionData should reject invalid token', async () => {
      utils.isValidId.mockReturnValue(false);

      const token = 'token';
      const r = await sesstore.sessionData({ token });

      expect(r).not.toBeDefined();
      expect(utils.isValidId).toBeCalledTimes(1);
    });

    test('sessionData should reject not found session', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.get.mockResolvedValue(undefined);

      const token = 'token';
      const r = await sesstore.sessionData({ token });

      expect(r).not.toBeDefined();
      expect(utils.isValidId).toBeCalledTimes(1);
      expect(kvstore.get).toBeCalledTimes(1);
    });

    test('sessionData should throw on kvstore failure', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.get.mockRejectedValue(new Error('TEST'));

      const token = 'token';
      await expect(sesstore.sessionData({ token })).rejects.toThrow('TEST');

      expect(utils.isValidId).toBeCalledTimes(1);
      expect(kvstore.get).toBeCalledTimes(1);
    });
  });

  describe('renewSession', () => {
    test('renewSession should work', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.renew.mockResolvedValue(true);

      const token = 'token';
      const r = await sesstore.renewSession({ token });

      expect(r.token).toEqual(token);
      expect(r.expires).toBeLessThanOrEqual(
        Date.now() + config.sessionTtlMillis
      );

      expect(utils.isValidId).toBeCalledTimes(1);
      expect(utils.isValidId).toHaveBeenNthCalledWith(1, token);

      expect(kvstore.renew).toBeCalledTimes(1);
      expect(kvstore.renew).toHaveBeenNthCalledWith(
        1,
        `${config.sessionTag}:${token}`,
        config.sessionTtlMillis
      );
    });

    test('renewSession should reject invalid token', async () => {
      utils.isValidId.mockReturnValue(false);

      const token = 'token';
      const r = await sesstore.renewSession({ token });

      expect(r).not.toBeDefined();
      expect(utils.isValidId).toBeCalledTimes(1);
    });

    test('renewSession should reject not found session', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.renew.mockResolvedValue(undefined);

      const token = 'token';
      const r = await sesstore.renewSession({ token });

      expect(r).not.toBeDefined();
      expect(utils.isValidId).toBeCalledTimes(1);
      expect(kvstore.renew).toBeCalledTimes(1);
    });

    test('renewSession should throw on kvstore failure ', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.renew.mockRejectedValue(new Error('TEST'));

      const token = 'token';
      await expect(sesstore.renewSession({ token })).rejects.toThrow('TEST');

      expect(utils.isValidId).toBeCalledTimes(1);
      expect(kvstore.renew).toBeCalledTimes(1);
    });
  });

  describe('endSession', () => {
    test('endSession should work', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.del.mockResolvedValue(true);

      const token = 'token';
      const r = await sesstore.endSession({ token });

      expect(r).toBe(true);

      expect(utils.isValidId).toBeCalledTimes(1);
      expect(utils.isValidId).toHaveBeenNthCalledWith(1, token);

      expect(kvstore.del).toBeCalledTimes(1);
      expect(kvstore.del).toHaveBeenNthCalledWith(
        1,
        `${config.sessionTag}:${token}`
      );
    });

    test('endSession should reject invalid token', async () => {
      utils.isValidId.mockReturnValue(false);

      const token = 'token';
      const r = await sesstore.endSession({ token });

      expect(r).not.toBeDefined();
      expect(utils.isValidId).toBeCalledTimes(1);
    });

    test('endSession should throw on kvstore failure ', async () => {
      utils.isValidId.mockReturnValue(true);
      kvstore.del.mockRejectedValue(new Error('TEST'));

      const token = 'token';
      await expect(sesstore.endSession({ token })).rejects.toThrow('TEST');

      expect(utils.isValidId).toBeCalledTimes(1);
      expect(kvstore.del).toBeCalledTimes(1);
    });
  });
});

describe('session.js development', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  test('development code should be included in non-production', async () => {
    process.env.NODE_ENV = 'development';
    const sesstore = require('../sesstore');
    const kvstore = require('../kvstore');
    const keys = ['value1:key1', 'value2:key2'];
    kvstore.keys.mockResolvedValue(keys);
    kvstore.delPattern.mockResolvedValue(true);

    await sesstore.devSessions();
    await sesstore.devClearSessions();
  });
  test('development code should not be included in production', async () => {
    process.env.NODE_ENV = 'production';
    const sesstore = require('../sesstore');
    expect(sesstore.devSessions).not.toBeDefined();
    expect(sesstore.devClearSessions).not.toBeDefined();
  });
});
