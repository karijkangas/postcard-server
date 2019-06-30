/*
 *
 */
/* eslint-disable global-require */
jest.mock('ws');

const processExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

let WebSocket;

describe('wss-healthcheck.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    WebSocket = require('ws');
  });

  test('wss-healthcheck should work', async () => {
    const ws = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
    };
    WebSocket.mockImplementation(() => ws);

    require('../healthcheck-wss');

    expect(ws.on).toBeCalledTimes(2);
    expect(ws.on).toHaveBeenNthCalledWith(1, 'open', expect.any(Function));
    expect(ws.on).toHaveBeenNthCalledWith(2, 'message', expect.any(Function));

    ws.on.mock.calls[0][1]();
    expect(ws.send).toBeCalledTimes(1);
    expect(ws.send).toHaveBeenNthCalledWith(1, 'HELLO');

    ws.on.mock.calls[1][1]('HELLO');
    expect(ws.close).toBeCalledTimes(1);
    expect(processExit).toBeCalledTimes(1);
    expect(processExit).toHaveBeenNthCalledWith(1, 0);

    ws.on.mock.calls[1][1]('FOOBAR');
    expect(ws.close).toBeCalledTimes(2);
    expect(processExit).toBeCalledTimes(2);
    expect(processExit).toHaveBeenNthCalledWith(2, 1);
  });
  test('wss-healthcheck should report failure', async () => {
    WebSocket.mockImplementation(() => {
      throw new Error('TEST');
    });

    require('../healthcheck-wss');

    expect(processExit).toBeCalledTimes(1);
    expect(processExit).toHaveBeenNthCalledWith(1, 1);
  });
});
