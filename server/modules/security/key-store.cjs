const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

// API keys are deliberately stored as local JSON. The app is a local-only
// workspace, and the user has chosen filesystem access as the protection
// boundary instead of a machine/profile-bound encryption provider.
const PROVIDERS = ['openrouter', 'replicate', 'gemini', 'openai', 'minimax', 'artificial-analysis'];
const PLAINTEXT_FORMAT = 'code-kai-plaintext-v1';
const LEGACY_ENCRYPTED_FORMAT = 'code-kai-dpapi-v1';

function createKeyStore(file) {
  let cached;
  let signature;

  const empty = () => Object.fromEntries(PROVIDERS.map((name) => [name, '']));

  function validate(keys) {
    if (
      !keys ||
      typeof keys !== 'object' ||
      Array.isArray(keys) ||
      Object.keys(keys).some((key) => !PROVIDERS.includes(key))
    ) {
      throw new Error('Formato de claves inválido');
    }
    for (const value of Object.values(keys)) {
      if (typeof value !== 'string' || value.length > 1024) {
        throw new Error('Formato de claves inválido');
      }
    }
    return { ...empty(), ...keys };
  }

  function currentSignature() {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  }

  // Preserve an old encrypted file before a future save replaces it. The
  // backup never becomes part of the active configuration and is created only
  // once so repeated starts cannot overwrite it.
  function preserveLegacyFile() {
    const backup = `${file}.dpapi-backup`;
    try {
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`No se pudo conservar el respaldo de claves antiguas: ${error.message}`);
      }
    }
    try {
      fs.chmodSync(backup, 0o600);
    } catch {
      /* Windows treats this as advisory. */
    }
    return backup;
  }

  function writePlain(keys) {
    const normalized = validate(keys);
    const payload = JSON.stringify({ format: PLAINTEXT_FORMAT, keys: normalized });
    const temporary = `${file}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, payload, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* Windows treats this as advisory. */
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    cached = normalized;
    signature = currentSignature();
  }

  function save(keys) {
    if (fs.existsSync(file)) {
      try {
        const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (previous && previous.format === LEGACY_ENCRYPTED_FORMAT) preserveLegacyFile();
      } catch {
        // Validation of the replacement still happens below. A malformed
        // local file is not allowed to prevent the user from saving new keys.
      }
    }
    writePlain(keys);
  }

  function read() {
    if (!fs.existsSync(file)) return empty();
    const current = currentSignature();
    if (cached && signature === current) return { ...cached };

    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stored && stored.format === LEGACY_ENCRYPTED_FORMAT) {
      // The previous DPAPI profile is intentionally disabled. Keep the file
      // intact for recovery and let the settings screen accept replacement
      // keys in the new plaintext format.
      preserveLegacyFile();
      cached = empty();
      signature = current;
      return { ...cached };
    }

    const keys = stored && stored.format === PLAINTEXT_FORMAT ? stored.keys : stored;
    cached = validate(keys);
    signature = current;
    return { ...cached };
  }

  return { read, save };
}

module.exports = { createKeyStore, PROVIDERS, PLAINTEXT_FORMAT, LEGACY_ENCRYPTED_FORMAT };
