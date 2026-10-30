const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

/** Launch only Kubrick's fixed engine recipe, never arbitrary commands or another installation. */
async function startLocalEngine(appRoot) {
  if (process.platform !== 'win32')
    throw new Error('Inicia ComfyUI 0.43.0 en 127.0.0.1:8189 para usar inferencia local.');
  const shell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  await runFile(
    shell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(appRoot, 'scripts', 'start-comfyui.ps1'),
    ],
    { cwd: appRoot, windowsHide: true, timeout: 30000 },
  );
}
module.exports = { startLocalEngine };
