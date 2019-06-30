/*
 *
 */
module.exports = {
  initialize: jest.fn(),
  shutdown: jest.fn(),
  createRegistrationRequest: jest.fn(),
  resolveRegistrationRequest: jest.fn(),
  createPasswordResetRequest: jest.fn(),
  resolvePasswordResetRequest: jest.fn(),
  resolveEmailChangeRequest: jest.fn(),
  createEmailChangeRequest: jest.fn(),
  createEndpointRequest: jest.fn(),
  resolveEndpointRequest: jest.fn(),
};
