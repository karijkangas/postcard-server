/*
 *
 */
/* eslint-disable global-require */

jest.mock('../kvstore');
jest.mock('../utils');
jest.mock('../logger');
jest.mock('../config');

describe('registry.js', () => {
  jest.resetModules();
  jest.useFakeTimers();

  const config = require('../config');
  config.requestTag = 'request-tag';
  config.requestTtlMillis = 1234;

  const Kvstore = require('../kvstore');
  const Utils = require('../utils');
  const reqstore = require('../reqstore');

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe.each([
    [
      'RegistrationRequest',
      'REGISTRATION',
      reqstore.createRegistrationRequest,
      reqstore.resolveRegistrationRequest,
    ],
    [
      'PasswordResetRequest',
      'PASSWORD_RESET',
      reqstore.createPasswordResetRequest,
      reqstore.resolvePasswordResetRequest,
    ],
    [
      'EmailChangeRequest',
      'EMAIL_CHANGE',
      reqstore.createEmailChangeRequest,
      reqstore.resolveEmailChangeRequest,
    ],
    [
      'EndpointRequest',
      'ENDPOINT',
      reqstore.createEndpointRequest,
      reqstore.resolveEndpointRequest,
    ],
  ])('%s', (request, type, createFn, resolveFn) => {
    test('create should work', async () => {
      const id = 'id';
      Utils.createId.mockReturnValue(id);
      Kvstore.set.mockResolvedValue(true);

      const data = { key: 'value' };
      const r = await createFn(data);

      expect(Utils.createId).toBeCalledTimes(1);

      expect(r.id).toEqual(id);
      expect(r.expires).toBeLessThanOrEqual(
        Date.now() + config.requestTtlMillis
      );

      expect(Kvstore.set).toBeCalledTimes(1);
      expect(Kvstore.set).toHaveBeenNthCalledWith(
        1,
        `${config.requestTag}_${type}:${id}`,
        JSON.stringify(data),
        config.requestTtlMillis
      );
    });

    test('create should handle kvstore failure correctly', async () => {
      const id = 'id';
      Utils.createId.mockReturnValue(id);
      Kvstore.set.mockRejectedValue(new Error('TEST'));

      const data = { key: 'value' };
      await expect(createFn(data)).rejects.toThrow('TEST');

      expect(Utils.createId).toBeCalledTimes(1);
      expect(Kvstore.set).toBeCalledTimes(1);
    });

    test('resolve should work', async () => {
      Utils.isValidId.mockReturnValue(true);
      const data = { key: 'value' };
      Kvstore.remove.mockResolvedValue(JSON.stringify(data));

      const id = 'id';
      const r = await resolveFn(id);

      expect(r).toBeDefined();
      expect(r).toEqual(data);

      expect(Utils.isValidId).toBeCalledTimes(1);
      expect(Utils.isValidId).toHaveBeenNthCalledWith(1, id);

      expect(Kvstore.remove).toBeCalledTimes(1);
      expect(Kvstore.remove).toHaveBeenNthCalledWith(
        1,
        `${config.requestTag}_${type}:${id}`
      );
    });

    test('resolve should handle invalid id', async () => {
      Utils.isValidId.mockReturnValue(false);

      const id = 'id';
      const r = await resolveFn(id);

      expect(r).not.toBeDefined();

      expect(Utils.isValidId).toBeCalledTimes(1);
      expect(Kvstore.remove).not.toBeCalled();
    });

    test('resolve should handle not found request', async () => {
      Utils.isValidId.mockReturnValue(true);
      Kvstore.remove.mockResolvedValue(undefined);

      const id = 'id';
      const r = await resolveFn(id);

      expect(r).not.toBeDefined();

      expect(Utils.isValidId).toBeCalledTimes(1);
      expect(Kvstore.remove).toBeCalledTimes(1);
    });

    test('resolve should handke kvstore failure correctly', async () => {
      Utils.isValidId.mockReturnValue(true);
      Kvstore.remove.mockRejectedValue(new Error('TEST'));

      const id = 'id';
      await expect(resolveFn(id)).rejects.toThrow('TEST');

      expect(Utils.isValidId).toBeCalledTimes(1);
      expect(Kvstore.remove).toBeCalledTimes(1);
    });
  });
});

describe('registry.js development', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  test('development code should be included in non-production', async () => {
    process.env.NODE_ENV = 'development';
    const reqstore = require('../reqstore');
    const Kvstore = require('../kvstore');
    const keys = ['value1:key1', 'value2:key2'];
    Kvstore.keys.mockResolvedValue(keys);
    Kvstore.delPattern.mockResolvedValue(true);

    await reqstore.devPendingRegistrationRequests();
    await reqstore.devPendingPasswordResetRequests();
    await reqstore.devPendingEmailChangeRequests();
    await reqstore.devPendingEndpointRequests();
    await reqstore.devClearRequests();
  });
  test('development code should not be included in production', async () => {
    process.env.NODE_ENV = 'production';
    const reqstore = require('../reqstore');
    expect(reqstore.devPendingRegistrationRequests).not.toBeDefined();
    expect(reqstore.devPendingPasswordResetRequest).not.toBeDefined();
    expect(reqstore.devPendingEmailChangeRequests).not.toBeDefined();
    expect(reqstore.devPendingEndpointRequests).not.toBeDefined();
    expect(reqstore.devClearRequests).not.toBeDefined();
  });
});
