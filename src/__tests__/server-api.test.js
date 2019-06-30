/*
 *
 */
/* eslint-disable global-require */
jest.mock('../app');
jest.mock('../config');
jest.mock('../logger');

const processOn = jest.spyOn(process, 'on').mockImplementation(() => {});
const processExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

const { initialize, shutdown } = require('../app');
const config = require('../config');
const { info } = require('../logger');

const { resolvePromises } = require('./util');

describe('server-api.js', () => {
  beforeEach(() => {
    // jest.resetModuleRegistry();
    jest.resetAllMocks();
  });

  test('starting server', async () => {
    const listen = jest.fn();
    initialize.mockResolvedValue({ listen });
    config.apiPort = 1234;

    require('../server-api');

    await resolvePromises();

    expect(processOn).toHaveBeenNthCalledWith(
      1,
      'SIGTERM',
      expect.any(Function)
    );

    expect(info).toBeCalledTimes(1);
    expect(initialize).toBeCalledTimes(1);
    expect(listen).toBeCalledTimes(1);
    expect(listen).toHaveBeenNthCalledWith(
      1,
      config.apiPort,
      expect.any(Function)
    );

    listen.mock.calls[0][1]();

    expect(shutdown).not.toBeCalled();
    expect(processExit).not.toBeCalled();

    shutdown.mockResolvedValue(true);
    await processOn.mock.calls[0][1]();
    await resolvePromises();

    expect(shutdown).toBeCalled();
    expect(processExit).toBeCalledWith(0);

    shutdown.mockRejectedValue(new Error('TEST'));
    await processOn.mock.calls[0][1]();
    await resolvePromises();
  });
});
