const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID: uuidv4 } = require('node:crypto');
const { security, validation } = require('./modules/security/index.cjs');
const { verifyModel } = require('./modules/media/index.cjs');
function installHTTP(
  app,
  {
    port: PORT,
    appRoot,
    projectStore,
    getApiKeys,
    assertProject,
    PROJECTS_DIR,
    LUNA_PRO_MAX_COMPLETION_TOKENS,
  },
) {
  security.installLocalSecurity(app, PORT);
  app.use(express.json({ limit: '22mb' }));
  app.use(['/api', '/projects'], (req, res, next) => {
    try {
      projectStore.recover();
      next();
    } catch {
      res.status(503).json({
        error:
          'Almacenamiento pendiente de recuperación. No se aceptan cambios hasta recuperar la operación anterior.',
      });
    }
  });
  app.get('/config.html', (req, res) => res.redirect(302, '/'));
  app.get(['/', '/index.html'], (req, res) => {
    const html = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html.replace(/<script\b/g, `<script nonce="${res.locals.nonce}"`));
  });
  app.get('/vendor/purify.js', (req, res) => res.sendFile(require.resolve('dompurify/dist/purify.min.js')));
  app.get('/models/:filename', (req, res) => {
    try {
      const file = security.containedPath(path.join(appRoot, 'public', 'models'), req.params.filename);
      verifyModel(req.params.filename, fs.readFileSync(file));
      res.sendFile(file);
    } catch {
      res.status(503).json({ error: 'Modelo no disponible o pendiente de verificar.' });
    }
  });
  app.use(express.static(path.join(appRoot, 'public'), { index: false, dotfiles: 'deny' }));
  app.get('/projects/:projectId/content/:filename', (req, res, next) => {
    try {
      assertProject(req.params.projectId);
      const filename = req.params.filename;
      // Film previews are the only videos a project serves.
      if (!security.IMAGE_NAME.test(filename) && !/^film-[a-f0-9-]{36}\.mp4$/i.test(filename))
        throw security.fail('Invalid media filename');
      if (/-face\.png$/i.test(filename)) res.setHeader('Cache-Control', 'no-store');
      res.sendFile(security.containedPath(PROJECTS_DIR, req.params.projectId, 'content', filename));
    } catch (error) {
      next(error);
    }
  });
  app.use('/projects', (req, res) => res.sendStatus(404));
  app.use('/api', (req, res, next) => {
    req.requestId = uuidv4();
    res.setHeader('X-Request-ID', req.requestId);
    let secrets;
    try {
      secrets = Object.values(getApiKeys());
    } catch (error) {
      // Project and media routes remain usable if the local key file is malformed
      // or temporarily unavailable; this middleware must not make the entire
      // library appear empty.
      secrets = [];
      req.keyStoreUnavailable = true;
      console.warn('[Keys] API key store unavailable; continuing local project request:', error.message);
    }
    const json = res.json.bind(res);
    res.json = (data) => json(security.redact(data, secrets));
    if (req.path.startsWith('/ai/') && req.method === 'POST') {
      try {
        validation.validateAI(req.path.slice(4), req.body);
        if (req.body.projectId !== undefined) assertProject(req.body.projectId);
        if (req.body.options !== undefined) {
          const opts = req.body.options;
          if (!opts || typeof opts !== 'object' || Array.isArray(opts))
            throw security.fail('Invalid options');
          for (const [key, value] of Object.entries(opts)) {
            if (
              !['temperature', 'top_p', 'max_tokens', 'max_completion_tokens'].includes(key) ||
              typeof value !== 'number' ||
              !Number.isFinite(value)
            )
              throw security.fail('Unsupported model option');
            if (
              value < 0 ||
              value >
                (['max_tokens', 'max_completion_tokens'].includes(key)
                  ? LUNA_PRO_MAX_COMPLETION_TOKENS
                  : key === 'temperature'
                    ? 2
                    : 1)
            )
              throw security.fail('Model option outside limits');
          }
        }
      } catch (error) {
        return next(error);
      }
    }
    next();
  });
}
module.exports = { installHTTP };
