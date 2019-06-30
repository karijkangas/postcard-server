/*
 *
 */
const client = {
  presignedPutObject: jest.fn(),
  copyObject: jest.fn(),
  statObject: jest.fn(),
  presignedGetObject: jest.fn(),
  removeObject: jest.fn(),
  listObjects: jest.fn(),
  removeObjects: jest.fn(),
};
module.exports = {
  Client: jest.fn().mockImplementation(() => client),
};
