/*
 *
 */
/* eslint-disable global-require */

jest.mock('../queue');
jest.mock('../logger');

let logger; /* eslint-disable-line no-unused-vars */
let queue;

let Subscriber;

describe('subscriber.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    logger = require('../logger');
    queue = require('../queue');

    Subscriber = require('../subscriber');
  });

  test('initialize and shutdown work', async () => {
    const s = jest.fn().mockImplementation(() => Promise.resolve());
    queue.subscribe.mockResolvedValue(s);

    await Subscriber.initialize();
    expect(queue.subscribe).toBeCalledTimes(1);

    await Subscriber.initialize();
    expect(queue.subscribe).toBeCalledTimes(1);

    await Subscriber.shutdown();
    expect(s).toBeCalledTimes(1);
  });

  test('subscribe works', async () => {
    const s = jest.fn().mockImplementation(() => Promise.resolve());
    queue.subscribe.mockResolvedValue(s);

    await Subscriber.initialize();
    expect(queue.subscribe).toBeCalledTimes(1);

    expect(queue.subscribe).toHaveBeenNthCalledWith(1, expect.any(Function));

    const relayFn = queue.subscribe.mock.calls[0][0];

    const ws = {
      close: jest.fn(),
      on: jest.fn(),
      send: jest.fn(),
    };

    const userId = 'user-id';
    const message = { userId, data: { type: 'message' } };
    const logout = { userId, data: { type: 'LOGOUT' } };

    relayFn(JSON.stringify(message));

    expect(ws.close).not.toBeCalled();
    expect(ws.on).not.toBeCalled();
    expect(ws.send).not.toBeCalled();

    Subscriber.subscribe(userId, ws);

    expect(ws.on).toBeCalledTimes(1);
    expect(ws.on).toHaveBeenNthCalledWith(1, 'close', expect.any(Function));

    const closeFn = ws.on.mock.calls[0][1];

    relayFn(JSON.stringify(message));

    expect(ws.send).toBeCalledTimes(1);
    expect(ws.send).toHaveBeenNthCalledWith(1, JSON.stringify(message.data));

    Subscriber.subscribe(userId, ws);
    expect(ws.close).toBeCalledTimes(1);

    relayFn(JSON.stringify(logout));
    expect(ws.close).toBeCalledTimes(2);

    closeFn();

    relayFn(JSON.stringify(message));
    expect(ws.send).toBeCalledTimes(1);

    closeFn();
  });

  test('createMessage works', async () => {
    const userId = 'user-id';
    const data = { key: 'value' };
    expect(Subscriber.createMessage(userId, data)).toEqual(
      JSON.stringify({ userId, data })
    );
  });

  test('createLogoutMessage works', async () => {
    const userId = 'user-id';
    expect(Subscriber.createLogoutMessage(userId)).toEqual(
      JSON.stringify({ userId, data: { type: 'LOGOUT' } })
    );
  });
});
