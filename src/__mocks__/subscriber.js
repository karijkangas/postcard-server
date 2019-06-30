/*
 *
 */
module.exports = {
  initialize: jest.fn(),
  shutdown: jest.fn(),
  logout: jest.fn(),
  postcardReceived: jest.fn(),
  postcardDelivered: jest.fn(),
  setAsFriend: jest.fn(),
  createMessage: jest.fn(),
  createLogoutMessage: jest.fn(),
  subscribe: jest.fn(),
};
