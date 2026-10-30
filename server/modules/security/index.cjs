// Public server contract for security.
module.exports = {
  security: require('./security.cjs'),
  validation: require('./validation.cjs'),
  createKeyStore: (...args) => require('./key-store.cjs').createKeyStore(...args),
};
