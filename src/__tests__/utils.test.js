/*
 *
 */
/* eslint-disable global-require */

jest.mock('fs');

const fs = require('fs');
const utils = require('../utils');

describe('utils.js', () => {
  test('createId ok', async () => {
    const id1 = utils.createId();
    const id2 = utils.createId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toEqual(id2);
  });

  test('isValidId ok', async () => {
    const id1 = utils.createId();
    const id2 = utils.createId();

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();

    expect(utils.isValidId(id1)).toBeTruthy();
    expect(utils.isValidId(id2)).toBeTruthy();

    expect(utils.isValidId()).toBeFalsy();
    expect(utils.isValidId(123)).toBeFalsy();
    expect(utils.isValidId('invalid')).toBeFalsy();
  });

  test('inRange ok', async () => {
    expect(utils.inRange(3, 2, 4)).toBeTruthy();
    expect(utils.inRange(2, 2, 4)).toBeTruthy();
    expect(utils.inRange(4, 2, 4)).toBeTruthy();

    expect(utils.inRange(3, 2.1, 4.2)).toBeTruthy();
    expect(utils.inRange(2.1, 2.1, 4.2)).toBeTruthy();
    expect(utils.inRange(4.2, 2.1, 4.2)).toBeTruthy();

    expect(utils.inRange(6, 2, 4)).toBeFalsy();
  });

  test('envInt ok', async () => {
    const k = 'XXX_TEST_XXX';
    const valid = '123';
    const invalid = 'hello';

    process.env[k] = valid;
    expect(utils.envInt(k)).toEqual(parseInt(valid, 10));

    process.env[k] = invalid;
    expect(utils.envInt(k)).toBeUndefined();

    expect(utils.envInt('XXX_NOT_FOUND_XXX')).toBeUndefined();
  });

  test('envBool ok', async () => {
    const k = 'XXX_TEST_XXX';

    process.env[k] = 'true';
    expect(utils.envBool(k)).toBeTruthy();

    process.env[k] = 'false';
    expect(utils.envBool(k)).toBeFalsy();

    expect(utils.envBool('XXX_NOT_FOUND_XXX')).toBeUndefined();
  });

  test('fileString ok', async () => {
    const s = 'hello';
    const f = 'file.txt';
    fs.readFileSync = jest.fn().mockReturnValue(s);

    expect(utils.fileString(f)).toEqual(s);
    expect(fs.readFileSync).toBeCalledTimes(1);
    expect(fs.readFileSync).toHaveBeenNthCalledWith(1, f, {
      encoding: 'utf8',
    });

    fs.readFileSync = jest.fn().mockImplementation(() => {
      throw new Error('TEST');
    });
    expect(utils.fileString(f)).toBeUndefined();
    expect(fs.readFileSync).toBeCalledTimes(1);
    expect(fs.readFileSync).toHaveBeenNthCalledWith(1, f, {
      encoding: 'utf8',
    });
  });

  test('definedKeys ok', async () => {
    expect(utils.definedKeys({})).toEqual({});
    expect(utils.definedKeys({ key: undefined })).toEqual({});
    expect(utils.definedKeys({ key1: undefined, key2: 'yes' })).toEqual({
      key2: 'yes',
    });
    expect(
      utils.definedKeys({ key1: 'no', key2: 'yes', key3: undefined })
    ).toEqual({
      key1: 'no',
      key2: 'yes',
    });
  });

  test('changeHost ok', async () => {
    expect(utils.changeHost('http://foo.com', 'bar.net')).toBe(
      'http://bar.net/'
    );
    expect(utils.changeHost('https://foo.com/', 'bar.net')).toBe(
      'https://bar.net/'
    );
    expect(utils.changeHost('http://foo.com/buzz', 'bar.net')).toBe(
      'http://bar.net/buzz'
    );
    expect(utils.changeHost('http://foo.com:80/', 'bar.net:90')).toBe(
      'http://bar.net:90/'
    );
    expect(utils.changeHost('http://foo.com:80/buzz', 'bar.net:90')).toBe(
      'http://bar.net:90/buzz'
    );
  });

  test('hash ok', async () => {
    const s = 'hello';
    expect(utils.hash(s)).toEqual(utils.hash(s));
  });

  test('emailHash ok', async () => {
    const s = 'HELLO@example.com';
    expect(utils.emailHash(s)).toEqual(utils.emailHash(s.toLowerCase()));
  });
});
