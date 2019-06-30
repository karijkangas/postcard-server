/*
 *
 */
/* eslint-disable global-require */

jest.mock('../queue');
jest.mock('../subscriber');

let queue;
let subscriber;

let publisher;

describe('publisher.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    queue = require('../queue');
    subscriber = require('../subscriber');

    publisher = require('../publisher');
  });

  test('initialize and shutdown ok', async () => {
    const p = { close: jest.fn().mockResolvedValue(true) };
    queue.createPublisher.mockResolvedValue(p);

    await publisher.initialize();
    expect(queue.createPublisher).toBeCalledTimes(1);

    await publisher.initialize();
    expect(queue.createPublisher).toBeCalledTimes(1);

    await publisher.shutdown();
    expect(p.close).toBeCalledTimes(1);
  });

  test('postcardReceived ok', async () => {
    const pid = 'publish-id';
    const p = { publish: jest.fn().mockResolvedValue(pid) };
    queue.createPublisher.mockResolvedValue(p);
    const m = {};
    subscriber.createMessage.mockReturnValue(m);

    const user = 'user';
    const id = 'id';

    await publisher.initialize();
    expect(await publisher.postcardReceived(user, id)).toEqual(pid);

    expect(subscriber.createMessage).toBeCalledTimes(1);
    expect(subscriber.createMessage).toHaveBeenNthCalledWith(1, user, {
      type: 'postcard-received',
      id,
    });

    expect(p.publish).toBeCalledTimes(1);
    expect(p.publish).toHaveBeenNthCalledWith(1, m);
  });

  test('postcardDelivered ok', async () => {
    const pid = 'publish-id';
    const p = { publish: jest.fn().mockResolvedValue(pid) };
    queue.createPublisher.mockResolvedValue(p);
    const m = {};
    subscriber.createMessage.mockReturnValue(m);

    const user = 'user';
    const id = 'id';

    await publisher.initialize();
    expect(await publisher.postcardDelivered(user, id)).toEqual(pid);

    expect(subscriber.createMessage).toBeCalledTimes(1);
    expect(subscriber.createMessage).toHaveBeenNthCalledWith(1, user, {
      type: 'postcard-delivered',
      id,
    });

    expect(p.publish).toBeCalledTimes(1);
    expect(p.publish).toHaveBeenNthCalledWith(1, m);
  });

  test('setAsFriend ok', async () => {
    const pid = 'publish-id';
    const p = { publish: jest.fn().mockResolvedValue(pid) };
    queue.createPublisher.mockResolvedValue(p);
    const m = {};
    subscriber.createMessage.mockReturnValue(m);

    const user = 'user';
    const id = 'id';

    await publisher.initialize();
    expect(await publisher.setAsFriend(user, id)).toEqual(pid);

    expect(subscriber.createMessage).toBeCalledTimes(1);
    expect(subscriber.createMessage).toHaveBeenNthCalledWith(1, user, {
      type: 'set-as-friend',
      id,
    });

    expect(p.publish).toBeCalledTimes(1);
    expect(p.publish).toHaveBeenNthCalledWith(1, m);
  });

  test('logout ok', async () => {
    const pid = 'publish-id';
    const p = { publish: jest.fn().mockResolvedValue(pid) };
    queue.createPublisher.mockResolvedValue(p);
    const m = {};
    subscriber.createLogoutMessage.mockReturnValue(m);

    const user = 'user';

    await publisher.initialize();
    expect(await publisher.logout(user)).toEqual(pid);

    expect(subscriber.createLogoutMessage).toBeCalledTimes(1);
    expect(subscriber.createLogoutMessage).toHaveBeenNthCalledWith(1, user);

    expect(p.publish).toBeCalledTimes(1);
    expect(p.publish).toHaveBeenNthCalledWith(1, m);
  });
});
