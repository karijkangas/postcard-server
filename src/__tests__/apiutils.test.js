/*
 *
 */
/* eslint-disable global-require */

jest.unmock('bcryptjs');
jest.unmock('email-validator');
jest.unmock('password-validator');

jest.mock('../publisher');
jest.mock('../sesstore');
jest.mock('../config');

const bcrypt = require('bcryptjs');

let publisher;
let sesstore;
let config;

let apiutils;

const { resolvePromises } = require('./util');

describe('api-common.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    config = require('../config');
    config.connectionRetryDelay = 'connectionRetryDelay';
    config.saltRounds = 8;
    config.queryLimit = 123;

    publisher = require('../publisher');
    sesstore = require('../sesstore');

    apiutils = require('../apiutils');
  });

  test('sentReply ok', async () => {
    const res = {
      status: jest.fn().mockImplementation(() => res),
      json: jest.fn(),
    };
    const status = 200;
    const data = { foo: 'bar' };
    apiutils.sendReply(res, status, data);
    expect(res.status).toBeCalledTimes(1);
    expect(res.status).toHaveBeenNthCalledWith(1, status);
    expect(res.json).toBeCalledTimes(1);
    expect(res.json).toHaveBeenNthCalledWith(1, data);

    apiutils.sendReply(res);
    expect(res.status).toBeCalledTimes(2);
    expect(res.status).toHaveBeenNthCalledWith(2, 204);
    expect(res.json).toBeCalledTimes(2);
  });

  test('sentError ok', async () => {
    const res = {
      status: jest.fn().mockImplementation(() => res),
      json: jest.fn(),
    };
    const status = 404;
    const error = 'Not found';
    apiutils.sendError(res, status, error);
    expect(res.status).toBeCalledTimes(1);
    expect(res.status).toHaveBeenNthCalledWith(1, status);
    expect(res.json).toBeCalledTimes(1);
    expect(res.json).toHaveBeenNthCalledWith(1, { error });
  });

  test('asyncmw ok', async () => {
    const fn = jest.fn();
    const asyncmw = apiutils.asyncmw(fn);
    const req = {};
    const res = {};
    const next = jest.fn();

    await asyncmw(req, res, next);
    await resolvePromises();

    expect(fn).toBeCalledTimes(1);
    expect(fn).toHaveBeenNthCalledWith(1, req, res, next);
    expect(next).not.toBeCalled();

    const error = new Error('TEST');
    fn.mockRejectedValue(error);

    await asyncmw(req, res, next);
    await resolvePromises();

    expect(fn).toBeCalledTimes(2);
    expect(next).toBeCalledTimes(1);
    expect(next).toHaveBeenNthCalledWith(1, error);
  });

  describe('sesmw', () => {
    const sessionData = 'session-data';
    const sessionToken = 'session-token';
    const matchString = `POSTCARD-TOKEN token="${sessionToken}"`;
    const noMatchString = 'haxxors';

    const req = {};
    const res = {};
    let next;

    beforeEach(() => {
      req.get = jest.fn();
      res.status = jest.fn().mockImplementation(() => res);
      res.json = jest.fn();
      next = jest.fn();
    });

    test('sesmw ok', async () => {
      sesstore.sessionData.mockResolvedValue(sessionData);
      req.get.mockReturnValue(matchString);

      await apiutils.sesmw(req, res, next);
      await resolvePromises();

      expect(sesstore.sessionData).toBeCalledTimes(1);
      expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
        token: sessionToken,
      });

      expect(next).toBeCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeUndefined();
    });

    test('sesmw no auth string', async () => {
      req.get.mockReturnValue(undefined);

      await apiutils.sesmw(req, res, next);
      await resolvePromises();

      expect(sesstore.sessionData).not.toBeCalled();
      expect(next).not.toBeCalled();

      expect(res.status).toBeCalledTimes(1);
      expect(res.status).toHaveBeenNthCalledWith(1, 403);
      expect(res.json).toBeCalledTimes(1);
      expect(res.json).toHaveBeenNthCalledWith(1, {
        error: 'Invalid session',
      });
    });

    test('sesmw invalid auth string', async () => {
      req.get.mockReturnValue(noMatchString);

      await apiutils.sesmw(req, res, next);
      await resolvePromises();

      expect(sesstore.sessionData).not.toBeCalled();
      expect(next).not.toBeCalled();

      expect(res.status).toBeCalledTimes(1);
      expect(res.status).toHaveBeenNthCalledWith(1, 403);
      expect(res.json).toBeCalledTimes(1);
      expect(res.json).toHaveBeenNthCalledWith(1, {
        error: 'Invalid session',
      });
    });

    test('sesmw not found session', async () => {
      req.get.mockReturnValue(matchString);
      sesstore.sessionData.mockResolvedValue(undefined);

      await apiutils.sesmw(req, res, next);
      await resolvePromises();

      expect(sesstore.sessionData).toBeCalledTimes(1);
      expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
        token: sessionToken,
      });

      expect(next).not.toBeCalled();

      expect(res.status).toBeCalledTimes(1);
      expect(res.status).toHaveBeenNthCalledWith(1, 403);
      expect(res.json).toBeCalledTimes(1);
      expect(res.json).toHaveBeenNthCalledWith(1, {
        error: 'Invalid session',
      });
    });

    test('sesmw failed session', async () => {
      const e = new Error('TEST');
      req.get.mockReturnValue(matchString);
      sesstore.sessionData.mockRejectedValue(e);

      await apiutils.sesmw(req, res, next);
      await resolvePromises();

      expect(sesstore.sessionData).toBeCalledTimes(1);
      expect(sesstore.sessionData).toHaveBeenNthCalledWith(1, {
        token: sessionToken,
      });

      expect(next).toBeCalledTimes(1);
      expect(next).toHaveBeenNthCalledWith(1, e);

      expect(res.status).not.toBeCalled();
      expect(res.json).not.toBeCalled();
    });
  });

  test('validateName ok', () => {
    expect(apiutils.validateName('h')).toEqual('h');
    expect(apiutils.validateName('h ')).toEqual('h ');
    expect(apiutils.validateName('hello')).toEqual('hello');
    expect(apiutils.validateName()).toBeUndefined();
    expect(apiutils.validateName('')).toBeUndefined();
    expect(apiutils.validateName(' ')).toBeUndefined();
    expect(apiutils.validateName(123)).toBeUndefined();
  });

  test('validateEmail ok', () => {
    expect(apiutils.validateEmail('test@example.com')).toEqual(
      'test@example.com'
    );
    expect(apiutils.validateEmail('invalid')).toBeUndefined();
  });

  test('validatePassword ok', () => {
    expect(apiutils.validatePassword('asdQWE123')).toEqual('asdQWE123');
    expect(apiutils.validatePassword()).toBeUndefined();
    expect(apiutils.validatePassword(123)).toBeUndefined();
    expect(apiutils.validatePassword('')).toBeUndefined();
  });

  test('validateLanguage ok', () => {
    expect(apiutils.validateLanguage('en')).toEqual('en');
    expect(apiutils.validateLanguage('fi')).toEqual('fi');
    expect(apiutils.validateLanguage('invalid')).toBeUndefined();
  });

  test('hashPassword ok', async () => {
    const password = 'password';
    const hash = await apiutils.hashPassword(password);
    expect(hash).toBeDefined();
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await apiutils.hashPassword()).toBeUndefined();
  });

  test('comparePassword ok', async () => {
    const password = 'password';
    const salt = await bcrypt.genSalt(config.saltRounds);
    expect(salt).toBeDefined();
    const hash = await bcrypt.hash(password, salt);
    expect(hash).toBeDefined();
    expect(await apiutils.comparePassword(password, hash)).toBe(true);
    expect(await apiutils.comparePassword()).toBe(false);
    expect(await apiutils.comparePassword(undefined, hash)).toBe(false);
    expect(await apiutils.comparePassword('invalid', hash)).toBe(false);
  });

  test('reqSession ok', async () => {
    const req = { session: 'session' };
    expect(apiutils.reqSession(req)).toEqual(req.session);
    expect(apiutils.reqSession()).toBeUndefined();
    expect(apiutils.reqSession({})).toBeUndefined();
  });

  test('reqUser ok', async () => {
    const req = { session: { data: 'data' } };
    expect(apiutils.reqUser(req)).toEqual(req.session.data);
    expect(apiutils.reqUser()).toBeUndefined();
    expect(apiutils.reqUser({})).toBeUndefined();
    expect(apiutils.reqUser({ session: {} })).toBeUndefined();
  });

  test('endSession ok', async () => {
    publisher.logout.mockResolvedValue(true);
    sesstore.endSession.mockResolvedValue(true);
    const req = { session: { data: {} } };

    expect(await apiutils.endSession(req)).toBe(true);
    expect(publisher.logout).toBeCalledTimes(1);
    expect(publisher.logout).toHaveBeenNthCalledWith(1, req.session.data);
    expect(sesstore.endSession).toBeCalledTimes(1);
    expect(sesstore.endSession).toHaveBeenNthCalledWith(1, req.session);

    publisher.logout.mockRejectedValue(new Error('TEST'));
    expect(await apiutils.endSession(req)).toBe(true);
  });
});
