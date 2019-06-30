/*
 *
 */
/* eslint-disable global-require */

jest.mock('../utils');

test('config ok', async () => {
  const config = require('../config');
  expect(config.redis).toBeDefined();
});
