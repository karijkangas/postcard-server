/*
 *
 */

const pool = {
  on: jest.fn(),
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
};

function Pool() {
  return pool;
}

module.exports = {
  Pool,
};
