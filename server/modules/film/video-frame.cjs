const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const run = promisify(execFile);

/**
 * The last frame of a clip of the film, written as a PNG. One worker on the CPU of the engine's own Python (it has
 * PyAV): it reads a file of the project and writes another, nothing else.
 */
function createVideoFrames({ appRoot, execute = run }) {
  const python = path.join(
    appRoot,
    'local-generation/comfyui/.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return {
    async last(source, target) {
      await execute(python, [path.join(__dirname, 'video-frame.py'), source, target], {
        windowsHide: true,
        timeout: 60000,
      });
    },
  };
}
module.exports = { createVideoFrames };
