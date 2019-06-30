/*
 *
 */
const ses = {
  sendTemplatedEmail: jest.fn(),
};

module.exports = function s() {
  return ses;
};
