/*
 *
 */

const client = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  expire: jest.fn(),
  publish: jest.fn(),
  quit: jest.fn(),
};
module.exports = {
  createClient: jest.fn().mockImplementation(() => client),
};
