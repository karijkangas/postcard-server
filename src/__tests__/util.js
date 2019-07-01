/*
 *
 */
function resolvePromises() {
  return new Promise(resolve => {
    setImmediate(resolve);
  });
}

module.exports = { resolvePromises };
