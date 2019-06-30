/*
 *
 */
const Original = jest.requireActual('ws');

const fn = jest.fn();
fn.mockImplementation(p => new Original(p));
fn.Server = jest.fn().mockImplementation(p => new Original.Server(p));

module.exports = fn;
