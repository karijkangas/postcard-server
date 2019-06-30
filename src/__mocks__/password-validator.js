/*
 *
 */

const obj = {
  is: function is() {
    return obj;
  },
  min: function min() {
    return obj;
  },
  validate: jest.fn(),
};

module.exports = jest.fn().mockImplementation(function mock() {
  return obj;
});
