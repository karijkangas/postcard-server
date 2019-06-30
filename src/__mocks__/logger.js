/*
 *
 */
module.exports = {
  httpLogger: jest.fn().mockImplementation((req, res, next) => next()),
  info: jest.fn(),
  error: jest.fn(),
};
