/*
 *
 */
/* eslint-disable global-require */

jest.mock('redis');
jest.mock('../logger');
jest.mock('../config');

let redis;
let config;
let queue;

describe('queue.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    config = require('../config');
    config.redis = { option1: 'value1', option2: 'value2' };
    config.eventsChannel = 'events-channel';

    redis = require('redis');
    queue = require('../queue');
  });

  test('subscribe ok', async () => {
    const client = {
      on: jest.fn(),
      subscribe: jest.fn(),
      quit: jest.fn().mockImplementation(r => r()),
    };
    redis.createClient.mockReturnValue(client);

    const callback = jest.fn();
    const p = queue.subscribe(callback);

    expect(redis.createClient).toBeCalledTimes(1);
    expect(redis.createClient).toHaveBeenNthCalledWith(1, {
      ...config.redis,
      enable_offline_queue: false,
    });

    expect(client.on).toBeCalledTimes(3);
    expect(client.on).toHaveBeenNthCalledWith(1, 'error', expect.any(Function));
    expect(client.on).toHaveBeenNthCalledWith(2, 'ready', expect.any(Function));
    expect(client.on).toHaveBeenNthCalledWith(
      3,
      'message',
      expect.any(Function)
    );

    client.on.mock.calls[0][1](new Error('TEST'));
    client.on.mock.calls[1][1]();
    client.on.mock.calls[2][1]('channel', 'message');

    const unsubscribe = await p;

    await unsubscribe();

    client.quit.mockImplementation(() => {
      throw new Error('TEST');
    });
    await expect(unsubscribe()).rejects.toThrow('TEST');
  });

  test('subscribe exception in message callback', async () => {
    const client = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    redis.createClient.mockReturnValue(client);

    const callback = jest.fn().mockImplementation(() => {
      throw new Error('TEST');
    });
    queue.subscribe(callback);

    expect(redis.createClient).toBeCalledTimes(1);
    expect(client.on).toBeCalledTimes(3);

    client.on.mock.calls[1][1]();
    client.on.mock.calls[2][1]('channel', 'message');
  });

  test('subscribe fail', async () => {
    redis.createClient.mockImplementation(() => {
      throw new Error('TEST');
    });
    const callback = jest.fn();
    await expect(queue.subscribe(callback)).rejects.toThrow('TEST');
  });

  test('createPublisher ok', async () => {
    const client = {
      on: jest.fn(),
      publish: jest.fn().mockImplementation((channel, message, callback) => {
        callback(undefined);
      }),
      quit: jest.fn().mockImplementation(r => r()),
    };
    redis.createClient.mockReturnValue(client);

    const p = queue.createPublisher();

    expect(redis.createClient).toBeCalledTimes(1);
    expect(redis.createClient).toHaveBeenNthCalledWith(1, {
      ...config.redis,
      enable_offline_queue: false,
    });

    expect(client.on).toBeCalledTimes(2);
    expect(client.on).toHaveBeenNthCalledWith(1, 'error', expect.any(Function));
    expect(client.on).toHaveBeenNthCalledWith(2, 'ready', expect.any(Function));

    client.on.mock.calls[0][1](new Error('TEST'));
    client.on.mock.calls[1][1]();

    const publisher = await p;

    const m = 'hello';
    await publisher.publish(m);
    expect(client.publish).toBeCalledTimes(1);
    expect(client.publish).toHaveBeenNthCalledWith(
      1,
      config.eventsChannel,
      m,
      expect.any(Function)
    );

    await publisher.close();
    expect(client.quit).toBeCalledTimes(1);

    client.quit.mockImplementation(() => {
      throw new Error('TEST');
    });
    await expect(publisher.close()).rejects.toThrow('TEST');
  });

  test('createPublisher fail', async () => {
    redis.createClient.mockImplementation(() => {
      throw new Error('TEST');
    });
    await expect(queue.createPublisher()).rejects.toThrow('TEST');
  });
});
