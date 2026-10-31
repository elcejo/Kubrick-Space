// Public server contract for security.
module.exports = {
  security: require('./security.cjs'),
  validation: require('./validation.cjs'),
  createApiKeyVault: (...args) => require('./api-key-vault.cjs').createApiKeyVault(...args),
};
