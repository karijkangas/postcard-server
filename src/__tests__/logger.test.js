/*
 *
 */
/* eslint-disable global-require */

describe('logger.js', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('test interface', async () => {
    const logger = require('../logger');
    expect(logger.httpLogger).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.error).toBeDefined();
  });
});
