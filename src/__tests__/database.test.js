/*
 *
 */
/* eslint-disable global-require */

jest.mock('crypto');
jest.mock('pg');

jest.mock('../utils');
jest.mock('../config');
jest.mock('../logger');

let crypto;
let pg;
let pool;

let config;
let utils;
let logger;

let database;

describe('database.js', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();

    crypto = require('crypto');
    pg = require('pg');
    pool = new pg.Pool();

    config = require('../config');
    config.postgres = {};
    config.queryLimit = 1234;

    utils = require('../utils');
    logger = require('../logger');

    database = require('../database');
  });

  describe('helper functions', () => {
    test('isValidUserId should work', async () => {
      const id = 'user-id';
      utils.isValidId.mockReturnValue(true);
      expect(database.isValidUserId(id)).toBe(true);
      expect(utils.isValidId).toBeCalledTimes(1);
    });

    test('isValidPostcardId should work', async () => {
      const id = 'postcard-id';
      utils.isValidId.mockReturnValue(true);
      expect(database.isValidPostcardId(id)).toBe(true);
      expect(utils.isValidId).toBeCalledTimes(1);
    });

    test('isValidInviteId should work', async () => {
      const id = 'invite-id';
      utils.isValidId.mockReturnValue(true);
      expect(database.isValidInviteId(id)).toBe(true);
      expect(utils.isValidId).toBeCalledTimes(1);
    });

    test('isValidIndex should work', async () => {
      expect(database.isValidIndex(0)).toBe(true);
      expect(database.isValidIndex(1)).toBe(true);
      expect(database.isValidIndex(2)).toBe(true);
      expect(database.isValidIndex('2')).toBe(true);

      expect(database.isValidIndex(undefined)).toBe(false);
      expect(database.isValidIndex(null)).toBe(false);
      expect(database.isValidIndex('hello')).toBe(false);
      expect(database.isValidIndex(-1)).toBe(false);
      expect(database.isValidIndex('-1')).toBe(false);
      expect(database.isValidIndex(1.1)).toBe(false);
      expect(database.isValidIndex('1.1')).toBe(false);
      expect(database.isValidIndex({ foo: 'bar' })).toBe(false);
    });

    test('isValidLimit should work', async () => {
      utils.inRange.mockReturnValue(true);
      expect(database.isValidLimit(4)).toBe(true);
      expect(utils.inRange).toBeCalledTimes(1);
      expect(utils.inRange).toHaveBeenNthCalledWith(1, 4, 1, config.queryLimit);

      expect(database.isValidLimit('5')).toBe(true);
      expect(utils.inRange).toBeCalledTimes(2);
      expect(utils.inRange).toHaveBeenNthCalledWith(2, 5, 1, config.queryLimit);

      utils.inRange.mockClear();
      utils.inRange.mockReturnValue(false);
      expect(database.isValidLimit(1.1)).toBe(false);
      expect(database.isValidLimit('1.1')).toBe(false);
      expect(database.isValidLimit({ foo: 'bar' })).toBe(false);
      expect(utils.inRange).not.toBeCalled();

      expect(database.isValidLimit(undefined)).toBe(false);
      expect(database.isValidLimit(null)).toBe(false);
      expect(database.isValidLimit('hello')).toBe(false);
    });

    test('isValidIndexAndLimit should work', async () => {
      utils.inRange.mockReturnValue(true);
      expect(database.isValidIndexAndLimit(1, 2)).toBe(true);
    });

    test('isRegisteredUser should work', async () => {
      expect(database.isRegisteredUser({ passhash: true })).toBe(true);
      expect(database.isRegisteredUser()).toBe(false);
      expect(database.isRegisteredUser({})).toBe(false);
    });
  });

  describe('initialize and shutdown', () => {
    test('initialize and shutdown should work', async () => {
      const p = database.initialize();

      expect(pool.on).toBeCalledTimes(1);
      expect(pool.on).toHaveBeenNthCalledWith(1, 'error', expect.any(Function));

      const errorFn = pool.on.mock.calls[0][1];
      errorFn('TEST');
      expect(logger.error).toBeCalledTimes(1);
      expect(logger.error).toHaveBeenNthCalledWith(
        1,
        'database pool error: TEST'
      );

      expect(pool.query).toBeCalledTimes(1);
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        'SELECT NOW()',
        expect.any(Function)
      );

      const callbackFn = pool.query.mock.calls[0][1];
      callbackFn();

      await p;
      await database.initialize();

      pool.end.mockImplementation(resolve => resolve(true));
      await database.shutdown();
      await database.shutdown();

      expect(pool.end).toBeCalledTimes(1);
    });

    test('initialize should throw on database failure', async () => {
      const p = database.initialize();

      expect(pool.query).toBeCalledTimes(1);
      const callbackFn = pool.query.mock.calls[0][1];
      callbackFn(new Error('TEST'));

      await expect(p).rejects.toThrow('TEST');
    });

    test('initialize should throw on unexpected error', async () => {
      pool.query.mockImplementation(() => {
        throw new Error('TEST');
      });
      await expect(database.initialize()).rejects.toThrow('TEST');
    });
  });

  describe('addOrModifyUser', () => {
    test('addOrModifyUser should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      const user = {
        email: 'test@example.com',
        passhash: 'passhash',
        firstName: 'John',
        lastName: 'Random',
        language: 'language',
      };
      const newUser = {
        ...user,
        id: 'user-id',
      };

      pool.query.mockResolvedValueOnce({ rows: [newUser] });
      pool.query.mockResolvedValueOnce(true);
      pool.query.mockResolvedValueOnce(true);

      const u = await database.addOrModifyUser(user);
      expect(u).toEqual(newUser);

      expect(pool.query).toBeCalledTimes(1 + 3);
    });

    test('addOrModifyUser should ignore errors on clearing invites and ignores', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      const user = {
        email: 'test@example.com',
        passhash: 'passhash',
        firstName: 'John',
        lastName: 'Random',
        language: 'language',
      };
      const newUser = {
        ...user,
        id: 'user-id',
      };

      pool.query.mockResolvedValueOnce({ rows: [newUser] });
      pool.query.mockRejectedValueOnce(new Error('TEST'));
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const u = await database.addOrModifyUser(user);
      expect(u).toEqual(newUser);

      expect(pool.query).toBeCalledTimes(1 + 3);
    });

    test('addOrModifyUser should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const user = {
        email: 'test@example.com',
        passhash: 'passhash',
        firstName: 'John',
        lastName: 'Random',
        language: 'language',
      };

      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.addOrModifyUser(user)).rejects.toThrow('TEST');
      expect(pool.query).toBeCalledTimes(1 + 1);
      expect(crypto.createHash).not.toBeCalled();
    });

    test('addOrModifyUser should return undefined on conflict', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const user = {
        email: 'test@example.com',
        passhash: 'passhash',
        firstName: 'John',
        lastName: 'Random',
        language: 'language',
      };

      pool.query.mockRejectedValueOnce({ code: '23505' });

      expect(await database.addOrModifyUser(user)).not.toBeDefined();
      expect(pool.query).toBeCalledTimes(1 + 1);
      expect(crypto.createHash).not.toBeCalled();
    });
  });

  describe('getUser', () => {
    test('getUser should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const id = 'user-id';
      const user = {
        id,
        firstName: 'John',
        lastName: 'Random',
        email: 'test@example.com',
        passhash: 'passhash',
        language: 'language',
      };
      pool.query.mockResolvedValueOnce({ rows: [user] });

      const u = await database.getUser(id);
      expect(u).toEqual(user);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    // test('getUser should ignore invalid id', async () => {
    //   pool.query.mockImplementation((q, cb) => cb());
    //   await database.initialize();

    //   utils.isValidId.mockReturnValue(false);

    //   const id = 'user-id';
    //   expect(await database.getUser(id)).not.toBeDefined();

    //   expect(pool.query).toBeCalledTimes(1);
    // });

    test('getUser should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const id = 'user-id';
      await expect(database.getUser(id)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('getUsers', () => {
    test('getUsers should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const ids = ['id-1', 'id-2', 'id-3'];
      const users = [
        {
          id: 'id-3',
          firstName: 'John',
          lastName: 'Random',
          email: 'test-3@example.com',
          passhash: 'passhash',
          language: 'language',
        },
        {
          id: 'id-2',
          firstName: 'John',
          lastName: 'Random',
          email: 'test-2@example.com',
          passhash: 'passhash',
          language: 'language',
        },
        {
          id: 'id-1',
          firstName: 'John',
          lastName: 'Random',
          email: 'test-1@example.com',
          passhash: 'passhash',
          language: 'language',
        },
      ];
      pool.query.mockResolvedValueOnce({ rows: users });

      const u = await database.getUsers(ids);
      expect(u).toEqual(users);
      expect(u[0].id).toEqual(ids[0]);
      expect(u[1].id).toEqual(ids[1]);
      expect(u[2].id).toEqual(ids[2]);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('getUsers should ignore invalid ids', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const ids = ['id-1', 'id-2'];
      expect(await database.getUsers(ids)).toEqual([]);

      expect(pool.query).toBeCalledTimes(1);
    });

    test('getUsers should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const ids = ['id-1', 'id-2'];
      await expect(database.getUsers(ids)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('findUser', () => {
    test('findUser should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const email = 'test@example.com';
      const user = {
        id: 'id-1',
        firstName: 'John',
        lastName: 'Random',
        email: 'test@example.com',
        passhash: 'passhash',
        language: 'language',
      };
      pool.query.mockResolvedValueOnce({ rows: [user] });

      const u = await database.findUser(email);
      expect(u).toEqual(user);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('findUser should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const email = 'test@example.com';
      await expect(database.findUser(email)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('modifyUser', () => {
    test('modifyUser should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);

      const id = 'user-id';
      const newUser = {
        email: 'test@example.com',
        firstName: 'firstName',
        lastName: 'lastName',
        passhash: 'passhash',
        language: 'language',
        avatar: 'avatar',
      };
      pool.query.mockResolvedValueOnce({ rows: [newUser] });

      const u = await database.modifyUser(id, newUser);
      expect(u).toEqual(newUser);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('modifyUser should skip immutable keys', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);

      const id = 'id-1';
      const newUser = {
        id: 'id-2',
      };
      const user = {
        email: 'test@example.com',
        firstName: 'firstName',
        lastName: 'lastName',
        passhash: 'passhash',
        language: 'language',
        avatar: 'avatar',
      };
      pool.query.mockResolvedValueOnce({ rows: [user] });

      const u = await database.modifyUser(id, newUser);
      expect(u).toEqual(user);

      expect(pool.query).toBeCalledTimes(1 + 1);
      expect(pool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching('SELECT'),
        [id]
      );
    });

    // test('modifyUser should ignore invalid id', async () => {
    //   pool.query.mockImplementation((q, cb) => cb());
    //   await database.initialize();

    //   utils.isValidId.mockReturnValue(false);

    //   const id = 'user-id';
    //   expect(await database.modifyUser(id, {})).not.toBeDefined();

    //   expect(pool.query).toBeCalledTimes(1);
    // });

    test('modifyUser should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const id = 'user-id';
      const newUser = {
        email: 'test@example.com',
        firstName: 'firstName',
        lastName: 'lastName',
        passhash: 'passhash',
        language: 'language',
        avatar: 'avatar',
      };
      await expect(database.modifyUser(id, newUser)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('deleteUser', () => {
    test('deleteUser should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);

      const id = 'id-1';
      const user = {
        id,
        firstName: 'firstName',
        lastName: 'lastName',
        email: 'test@example.com',
        passhash: 'passhash',
        language: 'language',
      };
      pool.query.mockResolvedValueOnce({ rows: [user] });

      const u = await database.deleteUser(id);
      expect(u).toEqual(user);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    // test('deleteUser should ignore invalid id', async () => {
    //   pool.query.mockImplementation((q, cb) => cb());
    //   await database.initialize();

    //   // utils.isValidId.mockReturnValue(false);

    //   const id = 'id-1';
    //   expect(await database.deleteUser(id)).not.toBeDefined();

    //   expect(pool.query).toBeCalledTimes(1);
    // });

    test('deleteUser should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const id = 'id-1';
      await expect(database.deleteUser(id)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('getConnections', () => {
    test('getConnections should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const connections = [{}, {}];
      pool.query.mockResolvedValueOnce({ rows: connections });

      const excludedStartIndex = 1;
      const limit = 2;
      const r = await database.getConnections(
        userId,
        excludedStartIndex,
        limit
      );
      expect(r).toEqual(connections);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('deleteUser should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const userId = 'id-1';
      await expect(database.getConnections(userId)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('deleteConnection', () => {
    test('deleteConnection should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const friendId = 'friend-1';
      const connection = {};
      pool.query.mockResolvedValueOnce({ rows: [connection] });

      const u = await database.deleteConnection(userId, friendId);
      expect(u).toEqual(connection);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('deleteConnection should ignore invalid id', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const userId = 'id-1';
      const friendId = 'friend-1';
      expect(
        await database.deleteConnection(userId, friendId)
      ).not.toBeDefined();

      expect(pool.query).toBeCalledTimes(1);
    });

    test('deleteConnection should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const userId = 'id-1';
      const friendId = 'friend-1';
      await expect(database.deleteConnection(userId, friendId)).rejects.toThrow(
        'TEST'
      );

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('addBlocked', () => {
    test('addBlocked should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const blockedId = 'blocked-1';
      const blocked = {};
      pool.query.mockResolvedValueOnce({ rows: [blocked] });

      const u = await database.addBlocked(userId, blockedId);
      expect(u).toEqual(blocked);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('addBlocked should return undefined on conflict', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const blockedId = 'blocked-1';

      pool.query.mockRejectedValueOnce({ code: '23503' });
      expect(await database.addBlocked(userId, blockedId)).not.toBeDefined();

      pool.query.mockRejectedValueOnce({ code: '23505' });
      expect(await database.addBlocked(userId, blockedId)).not.toBeDefined();

      expect(pool.query).toBeCalledTimes(1 + 2);
    });

    test('addBlocked should ignore invalid id', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const userId = 'id-1';
      const blockedId = 'blocked-1';
      expect(await database.addBlocked(userId, blockedId)).not.toBeDefined();

      expect(pool.query).toBeCalledTimes(1);
    });

    test('addBlocked should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const id = 'id-1';
      const blockedId = 'friend-1';
      await expect(database.addBlocked(id, blockedId)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('getBlocked', () => {
    test('getBlocked should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const excludedStartIndex = 1;
      const limit = 2;
      const blocked = [{ id: 'blocked-1' }, { id: 'blocked-2' }];
      pool.query.mockResolvedValueOnce({ rows: blocked });

      const r = await database.getBlocked(userId, excludedStartIndex, limit);
      expect(r).toEqual(blocked);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('getBlocked should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const userId = 'id-1';
      const excludedStartIndex = 1;
      const limit = 2;
      await expect(
        database.getBlocked(userId, excludedStartIndex, limit)
      ).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('isBlocked', () => {
    test('isBlocked should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const receiver = 'id-1';
      const sender = 'id-2';
      const blocked = [{ id: 'blocked-1' }];
      pool.query.mockResolvedValueOnce({ rows: blocked });

      const r = await database.isBlocked(receiver, sender);
      expect(r).toBe(true);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('isBlocked should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const receiver = 'id-1';
      const sender = 'id-2';
      await expect(database.isBlocked(receiver, sender)).rejects.toThrow(
        'TEST'
      );

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('deleteBlocked', () => {
    test('deleteBlocked should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const blockedId = 'blocked-1';
      const blocked = {};
      pool.query.mockResolvedValueOnce({ rows: [blocked] });

      const u = await database.deleteBlocked(userId, blockedId);
      expect(u).toEqual(blocked);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    // test('deleteBlocked should ignore invalid id', async () => {
    //   pool.query.mockImplementation((q, cb) => cb());
    //   await database.initialize();

    //   // utils.isValidId.mockReturnValue(false);

    //   const userId = 'id-1';
    //   const blockedId = 'blocked-1';
    //   expect(await database.deleteBlocked(userId, blockedId)).not.toBeDefined();

    //   expect(pool.query).toBeCalledTimes(1);
    // });

    test('deleteBlocked should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      // utils.isValidId.mockReturnValue(true);
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      const userId = 'id-1';
      const blockedId = 'blocked-1';
      await expect(database.deleteBlocked(userId, blockedId)).rejects.toThrow(
        'TEST'
      );

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('addPostcard', () => {
    test('addPostcard should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const id = 'postcard-id';
      const postcard = {
        sender: 'sender',
        receiver: 'receiver',
        image: 'image',
        message: 'message',
        location: 'location',
      };
      const newPostcard = {
        id,
        ...postcard,
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newPostcard] });
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce(true);

      const u = await database.addPostcard(postcard);
      expect(u).toEqual(newPostcard);

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(5);
      expect(client.query.mock.calls[4][0]).toMatch('COMMIT');
      expect(client.release).toBeCalledTimes(1);
    });

    test('addPostcard should rollback on error', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const id = 'postcard-id';
      const postcard = {
        sender: 'sender',
        receiver: 'receiver',
        image: 'image',
        message: 'message',
        location: 'location',
      };
      const newPostcard = {
        id,
        ...postcard,
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newPostcard] });
      client.query.mockRejectedValueOnce(new Error('TEST'));
      client.query.mockResolvedValueOnce(true);

      await expect(database.addPostcard(postcard)).rejects.toThrow('TEST');

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(5);
      expect(client.query.mock.calls[4][0]).toMatch('ROLLBACK');
      expect(client.release).toBeCalledTimes(1);
    });

    test('addPostcard should not rollback on pool connect failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      pool.connect.mockRejectedValueOnce(new Error('TEST'));

      const postcard = {
        sender: 'sender',
        receiver: 'receiver',
        image: 'image',
        message: 'message',
        location: 'location',
      };

      await expect(database.addPostcard(postcard)).rejects.toThrow('TEST');

      expect(pool.connect).toBeCalledTimes(1);
    });

    test('addPostcard should return undefined on conflict', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const id = 'postcard-id';
      const postcard = {
        sender: 'sender',
        receiver: 'receiver',
        image: 'image',
        message: 'message',
        location: 'location',
      };
      const newPostcard = {
        id,
        ...postcard,
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newPostcard] });
      client.query.mockRejectedValueOnce({ code: '23505' });
      client.query.mockResolvedValueOnce(true);

      expect(await database.addPostcard(postcard)).not.toBeDefined();

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(5);
      expect(client.query.mock.calls[4][0]).toMatch('ROLLBACK');
      expect(client.release).toBeCalledTimes(1);
    });
  });

  // describe.skip('getPostcard', () => {
  //   test('getPostcard should work', async () => {
  //     pool.query.mockImplementation((q, cb) => cb());
  //     await database.initialize();

  //     const id = 'id-1';
  //     const postcard = { id };
  //     pool.query.mockResolvedValueOnce({ rows: [postcard] });

  //     const r = await database.getPostcard(id);
  //     expect(r).toEqual(postcard);

  //     expect(pool.query).toBeCalledTimes(1 + 1);
  //   });

  //   test('getPostcard should throw on database failure', async () => {
  //     pool.query.mockImplementation((q, cb) => cb());
  //     await database.initialize();

  //     pool.query.mockRejectedValueOnce(new Error('TEST'));

  //     const id = 'id-1';
  //     await expect(database.getPostcard(id)).rejects.toThrow('TEST');

  //     expect(pool.query).toBeCalledTimes(1 + 1);
  //   });
  // });

  describe('getPostcards', () => {
    test('getPostcards should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const ids = ['postcard-1', 'postcard-2', 'postcard-3'];
      const postcards = [
        {
          id: 'postcard-2',
        },
        {
          id: 'postcard-3',
        },
        {
          id: 'postcard-1',
        },
      ];
      pool.query.mockResolvedValueOnce({ rows: postcards });

      const r = await database.getPostcards(userId, ids);
      expect(r).toEqual(postcards);
      expect(r[0].id).toEqual(ids[0]);
      expect(r[1].id).toEqual(ids[1]);
      expect(r[2].id).toEqual(ids[2]);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('getPostcards should reject invalid ids', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const userId = 'id-1';
      const ids = ['postcard-1', 'postcard-2', 'postcard-3'];

      expect(await database.getPostcards(userId, ids)).toEqual([]);
      expect(pool.query).toBeCalledTimes(1 + 0);
    });

    test('getPostcards should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const ids = ['postcard-1', 'postcard-2', 'postcard-3'];
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.getPostcards(userId, ids)).rejects.toThrow('TEST');
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('getInbox', () => {
    test('getInbox should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const excludedStartIndex = 1;
      const limit = 2;
      const postcards = [{ id: 'postcard-1' }, { id: 'postcard-2' }];
      pool.query.mockResolvedValueOnce({ rows: postcards });

      const r = await database.getInbox(userId, excludedStartIndex, limit);
      expect(r).toEqual(postcards);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('getInbox should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const excludedStartIndex = 1;
      const limit = 2;
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(
        database.getInbox(userId, excludedStartIndex, limit)
      ).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('removeFromInbox', () => {
    test('removeFromInbox should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const index = 1;
      const postcard = { id: 'postcard-1' };
      pool.query.mockResolvedValueOnce({ rows: [postcard] });

      const r = await database.removeFromInbox(userId, index);
      expect(r).toEqual(postcard);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('removeFromInbox should reject invalid index', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const index = -1;

      expect(await database.removeFromInbox(userId, index)).not.toBeDefined();
      expect(pool.query).toBeCalledTimes(1 + 0);
    });

    test('removeFromInbox should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const index = 1;
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.removeFromInbox(userId, index)).rejects.toThrow(
        'TEST'
      );
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('setAsRead', () => {
    test('setAsRead should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const id = 'postcard-1';
      const postcard = { id: 'postcard-1' };
      pool.query.mockResolvedValueOnce({ rows: [postcard] });

      const r = await database.setAsRead(userId, id);
      expect(r).toEqual(postcard);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('setAsRead should reject invalid id', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const userId = 'id-1';
      const id = 'postcard-id';
      expect(await database.setAsRead(userId, id)).not.toBeDefined();
      expect(pool.query).toBeCalledTimes(1 + 0);
    });

    test('setAsRead should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const id = 'postcard-1';
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.setAsRead(userId, id)).rejects.toThrow('TEST');
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('connectWithSender', () => {
    test('connectWithSender should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const friendId = 'friend-1';
      const postcardId = 'postcard-1';
      const connections = [
        {
          user: userId,
          friend: friendId,
        },
        {
          user: friendId,
          friend: userId,
        },
      ];
      pool.query.mockResolvedValueOnce({ rows: connections });

      const r = await database.connectWithSender(userId, postcardId);
      expect(r).toEqual({ user: userId, sender: friendId });

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('connectWithSender should reject invalid id', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const userId = 'id-1';
      const postcardId = 'postcard-1';
      expect(
        await database.connectWithSender(userId, postcardId)
      ).not.toBeDefined();
      expect(pool.query).toBeCalledTimes(1 + 0);
    });

    test('connectWithSender should return undefined on not found', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const postcardId = 'postcard-1';
      const connections = [];
      pool.query.mockResolvedValueOnce({ rows: connections });

      expect(
        await database.connectWithSender(userId, postcardId)
      ).not.toBeDefined();

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('connectWithSender should return undefined on conflict', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const postcardId = 'postcard-1';

      pool.query.mockRejectedValueOnce({ code: '23502' });
      expect(
        await database.connectWithSender(userId, postcardId)
      ).not.toBeDefined();

      pool.query.mockRejectedValueOnce({ code: '23505' });
      expect(
        await database.connectWithSender(userId, postcardId)
      ).not.toBeDefined();

      expect(pool.query).toBeCalledTimes(1 + 2);
    });

    test('connectWithSender should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const userId = 'id-1';
      const postcardId = 'postcard-1';
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(
        database.connectWithSender(userId, postcardId)
      ).rejects.toThrow('TEST');
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('getSent', () => {
    test('getSent should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const excludedStartIndex = 1;
      const limit = 2;
      const postcards = [{ id: 'postcard-1' }, { id: 'postcard-2' }];
      pool.query.mockResolvedValueOnce({ rows: postcards });

      const r = await database.getSent(userId, excludedStartIndex, limit);
      expect(r).toEqual(postcards);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('getSent should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const excludedStartIndex = 1;
      const limit = 2;
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(
        database.getSent(userId, excludedStartIndex, limit)
      ).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('removeFromSent', () => {
    test('removeFromSent should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const index = 1;
      const postcard = { id: 'postcard-1' };
      pool.query.mockResolvedValueOnce({ rows: [postcard] });

      const r = await database.removeFromSent(userId, index);
      expect(r).toEqual(postcard);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('removeFromSent should reject invalid index', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const index = -1;

      expect(await database.removeFromSent(userId, index)).not.toBeDefined();
      expect(pool.query).toBeCalledTimes(1 + 0);
    });

    test('removeFromSent should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const userId = 'id-1';
      const index = 1;
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.removeFromSent(userId, index)).rejects.toThrow(
        'TEST'
      );
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('deletePostcard', () => {
    test('deletePostcard should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const postcardId = 'postcard-1';
      const postcard = { id: postcardId };
      pool.query.mockResolvedValueOnce({ rows: [postcard] });

      const r = await database.deletePostcard(postcardId);
      expect(r).toEqual(postcard);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('deletePostcard should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const postcardId = 'postcard-1';
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.deletePostcard(postcardId)).rejects.toThrow('TEST');
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('addInvite', () => {
    test('addInvite should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const email = 'test@example.com';
      const newUser = {
        id: 'user-id',
      };
      const newInvite = {
        user: 'user-id',
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newUser] });
      client.query.mockResolvedValueOnce({ rows: [newInvite] });
      client.query.mockResolvedValueOnce(true);

      const u = await database.addInvite(email);
      expect(u).toEqual({ user: newUser, invite: newInvite });

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(4);
      expect(client.query.mock.calls[3][0]).toMatch('COMMIT');
      expect(client.release).toBeCalledTimes(1);
    });

    test('addInvite should return existing user', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const email = 'test@example.com';
      const newUser = {
        id: 'user-id',
        passhash: 'passhash',
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newUser] });
      client.query.mockResolvedValueOnce(true);

      const u = await database.addInvite(email);
      expect(u).toEqual({ user: newUser, invite: undefined });

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(3);
      expect(client.query.mock.calls[2][0]).toMatch('COMMIT');
      expect(client.release).toBeCalledTimes(1);
    });

    test('addInvite should rollback on error', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const email = 'test@example.com';
      const newUser = {
        id: 'user-id',
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newUser] });
      client.query.mockRejectedValueOnce(new Error('TEST'));
      client.query.mockResolvedValueOnce(true);

      await expect(database.addInvite(email)).rejects.toThrow('TEST');

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(4);
      expect(client.query.mock.calls[3][0]).toMatch('ROLLBACK');
      expect(client.release).toBeCalledTimes(1);
    });

    test('addInvite should not rollback on pool connect failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      pool.connect.mockRejectedValueOnce(new Error('TEST'));

      const email = 'test@example.com';
      await expect(database.addInvite(email)).rejects.toThrow('TEST');

      expect(pool.connect).toBeCalledTimes(1);
    });

    test('addPostcard should return undefined on conflict', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const email = 'test@example.com';
      const newUser = {
        id: 'user-id',
      };
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newUser] });
      client.query.mockRejectedValueOnce({ code: '23503' });
      client.query.mockResolvedValueOnce(true);

      expect(await database.addInvite(email)).not.toBeDefined();

      expect(pool.connect).toBeCalledTimes(1);
      expect(client.query).toBeCalledTimes(4);
      expect(client.query.mock.calls[3][0]).toMatch('ROLLBACK');
      expect(client.release).toBeCalledTimes(1);

      pool.connect.mockResolvedValueOnce(client);
      client.query.mockResolvedValueOnce(true);
      client.query.mockResolvedValueOnce({ rows: [newUser] });
      client.query.mockRejectedValueOnce({ code: '23505' });
      client.query.mockResolvedValueOnce(true);

      expect(await database.addInvite(email)).not.toBeDefined();
    });
  });

  describe('deleteInvite', () => {
    test('deleteInvite should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const inviteId = 'invite-1';
      const invite = { id: inviteId };
      pool.query.mockResolvedValueOnce({ rows: [invite] });

      const r = await database.deleteInvite(inviteId);
      expect(r).toEqual(invite);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('deleteInvite should reject invalid id', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(false);

      const inviteId = 'invite-1';

      expect(await database.deleteInvite(inviteId)).not.toBeDefined();
      expect(pool.query).toBeCalledTimes(1 + 0);
    });

    test('deleteInvite should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      utils.isValidId.mockReturnValue(true);

      const inviteId = 'invite-1';
      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.deleteInvite(inviteId)).rejects.toThrow('TEST');
      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('ignore', () => {
    test('ignore should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const email = 'test@example.com';
      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      pool.query.mockResolvedValueOnce(true);

      expect(await database.ignore(email)).toBe(true);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('ignore should return false on conflict', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const email = 'test@example.com';
      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      pool.query.mockRejectedValueOnce({ code: '23505' });

      expect(await database.ignore(email)).toBe(false);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('ignore should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const email = 'test@example.com';
      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.ignore(email)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });

  describe('isIgnored', () => {
    test('isIgnored should work', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const email = 'test@example.com';
      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      const ignored = { hash: 'passhash' };
      pool.query.mockResolvedValueOnce({ rows: [ignored] });

      expect(await database.isIgnored(email)).toBe(true);

      expect(pool.query).toBeCalledTimes(1 + 1);
    });

    test('isIgnored should throw on database failure', async () => {
      pool.query.mockImplementation((q, cb) => cb());
      await database.initialize();

      const email = 'test@example.com';
      const digest = 'digest';
      const hash = {
        update: jest.fn().mockImplementation(() => hash),
        digest: jest.fn().mockReturnValue(digest),
      };
      crypto.createHash.mockReturnValue(hash);

      pool.query.mockRejectedValueOnce(new Error('TEST'));

      await expect(database.isIgnored(email)).rejects.toThrow('TEST');

      expect(pool.query).toBeCalledTimes(1 + 1);
    });
  });
});

describe('database.js development', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  test('development code should be included in non-production', async () => {
    process.env.NODE_ENV = 'development';

    crypto = require('crypto');
    pg = require('pg');
    pool = new pg.Pool();

    config = require('../config');
    config.postgres = {};
    config.queryLimit = 1234;

    utils = require('../utils');
    logger = require('../logger');

    database = require('../database');

    pool.query.mockImplementation((q, cb) => cb());
    await database.initialize();

    const user = {
      email: 'test@example.com',
      passhash: 'passhash',
      firstName: 'John',
      lastName: 'Random',
      language: 'en',
    };
    const userId = 'user-1';
    const friendId = 'friend-1';
    const newUser = { id: userId };
    const newConnections = [
      { index: 1, user: userId, friend: friendId },
      { index: 2, user: friendId, friend: userId },
    ];
    const postcardId = 'postcard-1';
    const newPostcards = [
      {
        id: postcardId,
      },
    ];
    const inviteId = 'invite-1';
    const newInvites = [
      {
        id: inviteId,
      },
    ];
    const newIgnored = [
      {
        hash: 'passhash',
      },
    ];

    pool.query.mockResolvedValueOnce({ rows: [newUser] });
    expect(await database.devAddUser(user)).toEqual(newUser);

    pool.query.mockResolvedValueOnce({ rows: [newUser] });
    expect(await database.devGetUsers()).toEqual([newUser]);

    pool.query.mockResolvedValueOnce(true);
    await database.devClearUsers();

    pool.query.mockResolvedValueOnce({ rows: newConnections });
    expect(await database.devAddConnection(userId, friendId)).toEqual(
      newConnections
    );

    pool.query.mockResolvedValueOnce(true);
    await database.devClearConnections();

    pool.query.mockResolvedValueOnce(true);
    await database.devClearBlocked();

    pool.query.mockResolvedValueOnce({ rows: newPostcards });
    expect(await database.devGetPostcards()).toEqual(newPostcards);

    pool.query.mockResolvedValueOnce(true);
    await database.devClearPostcards();

    pool.query.mockResolvedValueOnce({ rows: newInvites });
    expect(await database.devGetInvites()).toEqual(newInvites);

    pool.query.mockResolvedValueOnce(true);
    await database.devClearInvites();

    pool.query.mockResolvedValueOnce({ rows: newIgnored });
    expect(await database.devGetIgnored()).toEqual(newIgnored);

    pool.query.mockResolvedValueOnce(true);
    await database.devClearIgnored();
  });

  test('development code should not be included in production', async () => {
    process.env.NODE_ENV = 'production';
    database = require('../database');
    expect(database.devAddUser).not.toBeDefined();
    expect(database.devGetUsers).not.toBeDefined();
    expect(database.devClearUsers).not.toBeDefined();
    expect(database.devAddConnection).not.toBeDefined();
    expect(database.devClearConnections).not.toBeDefined();
    expect(database.devClearBlocked).not.toBeDefined();
    expect(database.devGetPostcards).not.toBeDefined();
    expect(database.devClearPostcards).not.toBeDefined();
    expect(database.devGetInvites).not.toBeDefined();
    expect(database.devClearInvites).not.toBeDefined();
    expect(database.devGetIgnored).not.toBeDefined();
    expect(database.devClearIgnored).not.toBeDefined();
  });
});
