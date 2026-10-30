const { validateImageEngine } = require('../../../public/js/contracts/project-inference.js');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { parseCharacterDocument } = require('../../../public/js/contracts/character-model.js');
const { parseScenarioDocument } = require('../../../public/js/contracts/scenario.js');
const { parseFilmDocument } = require('../../../public/js/contracts/film.js');
const {
  validateCharacterVisualLibrary,
} = require('../../../public/js/contracts/character-visual-library.js');
const {
  validateScreenplayDocument,
  screenplaySceneDocument,
} = require('../../../public/js/contracts/screenplay.js');

const { UUID, IMAGE_NAME, MAX_IMAGE_BYTES, fail, imageType, decodeImage } = require('./primitives.cjs');

function cleanHTML(value) {
  return sanitizeHtml(value, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'font',
      'tag',
      'lock',
      'age',
      'skin',
      'complexion',
      'voice',
      'pitch',
      'lore',
      'psychology',
      'pseudonyms',
      'clothing',
    ],
    allowedAttributes: {
      tag: ['definition'],
      '*': ['class', 'title', 'style', 'data-kai-id'],
      a: ['href', 'title'],
      font: ['color'],
      span: ['class', 'data-tag', 'data-definition', 'data-kai-id', 'contenteditable', 'spellcheck'],
    },
    // Preserve the editor's text formatting without allowing URL-bearing CSS or overlays.
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        'text-align': [/^(left|right|center|justify)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-style': [/^(normal|italic|oblique)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
      },
    },
    allowedClasses: { '*': ['kai-tag', 'kai-block'] },
    allowedSchemes: ['https', 'http'],
  });
}

function cleanScreenplayInline(html) {
  return sanitizeHtml(cleanHTML(html), {
    allowedTags: ['span', 'font', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'br', 'tag', 'lock', 'a'],
    allowedAttributes: {
      span: ['class', 'style', 'data-tag', 'data-definition'],
      tag: ['definition'],
      font: ['color'],
      a: ['href'],
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-style': [/^(normal|italic|oblique)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
      },
    },
    allowedClasses: { '*': ['kai-tag', 'kai-character-tag', 'kai-block'] },
    allowedSchemes: ['https', 'http'],
  });
}
function validateScreenplayContent(content) {
  let parsed;
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content;
  } catch {
    return null;
  }
  if (parsed?.schema !== 'code-kai.screenplay') return null;
  return JSON.stringify(validateScreenplayDocument(parsed, cleanScreenplayInline));
}
function validateStoryBookContent(value) {
  return require('../../../public/js/contracts/story-book-validation.js').validateStoryBookContent(
    value,
    cleanHTML,
  );
}
function validateCoverComposition(data) {
  const allowed = new Set([
    'version',
    'title',
    'tagline',
    'author',
    'width',
    'height',
    'backgroundUrl',
    'layout',
    'textStyles',
    'createdAt',
    'generationMode',
    'sourcePrompt',
    'extraTexts',
    'decoration',
  ]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('Invalid cover composition');
  for (const key of Object.keys(data))
    if (!allowed.has(key)) throw fail(`Invalid cover composition field: ${key}`);
  if ('version' in data && (!Number.isSafeInteger(data.version) || data.version < 1))
    throw fail('Invalid cover composition version');
  for (const key of ['title', 'tagline', 'author']) {
    if (key in data && (typeof data[key] !== 'string' || data[key].length > (key === 'title' ? 300 : 200)))
      throw fail(`Invalid cover composition ${key}`);
  }
  for (const key of ['width', 'height']) {
    if (key in data && (!Number.isInteger(data[key]) || data[key] < 256 || data[key] > 4096))
      throw fail(`Invalid cover composition ${key}`);
  }
  if (
    'backgroundUrl' in data &&
    (typeof data.backgroundUrl !== 'string' ||
      !/^\/projects\/[0-9a-f-]{36}\/content\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.(png|jpe?g|webp|bmp)$/i.test(
        data.backgroundUrl,
      ))
  )
    throw fail('Invalid cover background URL');
  if ('createdAt' in data && (typeof data.createdAt !== 'string' || data.createdAt.length > 80))
    throw fail('Invalid cover composition timestamp');
  if ('generationMode' in data && !['proyecto', 'seleccion', 'personalizado'].includes(data.generationMode))
    throw fail('Invalid generation mode');
  if ('sourcePrompt' in data && (typeof data.sourcePrompt !== 'string' || data.sourcePrompt.length > 20000))
    throw fail('Invalid source prompt');
  if ('layout' in data) {
    const layout = data.layout;
    const layoutKeys = new Set(['titleY', 'taglineY', 'authorY', 'titleSize', 'taglineSize', 'authorSize']);
    if (
      !layout ||
      typeof layout !== 'object' ||
      Array.isArray(layout) ||
      Object.keys(layout).some((key) => !layoutKeys.has(key))
    )
      throw fail('Invalid cover composition layout');
    for (const key of Object.keys(layout))
      if (
        typeof layout[key] !== 'number' ||
        !Number.isFinite(layout[key]) ||
        layout[key] < (key.endsWith('Size') ? 1 : 0) ||
        layout[key] > (key.endsWith('Y') ? 1 : 4096)
      )
        throw fail('Invalid cover composition layout value');
  }
  if ('textStyles' in data) {
    const fonts = [
      'Cormorant Garamond',
      'EB Garamond',
      'Libre Baskerville',
      'Lora',
      'Playfair Display',
      'Bodoni Moda',
      'Cinzel',
      'DM Serif Display',
      'Montserrat',
      'Libre Franklin',
      'Georgia',
      'Arial',
      'Verdana',
      'Tahoma',
      'Trebuchet MS',
      'Times New Roman',
      'Courier New',
      'serif',
      'sans-serif',
      'monospace',
    ];
    fonts.push(
      'Abril Fatface',
      'Bebas Neue',
      'Oswald',
      'Raleway',
      'Merriweather',
      'Spectral',
      'Vollkorn',
      'Crimson Pro',
      'Prata',
      'Marcellus',
      'Great Vibes',
      'Josefin Sans',
    );
    if (!data.textStyles || typeof data.textStyles !== 'object' || Array.isArray(data.textStyles))
      throw fail('Invalid text styles');
    for (const [key, style] of Object.entries(data.textStyles)) {
      if (
        !['title', 'tagline', 'author'].includes(key) ||
        !style ||
        typeof style !== 'object' ||
        Array.isArray(style) ||
        Object.keys(style).some((k) => !['font', 'color', 'align', 'effect', 'hidden'].includes(k)) ||
        !fonts.includes(style.font) ||
        !/^#[0-9a-f]{6}$/i.test(style.color) ||
        ('align' in style && !['left', 'center', 'right'].includes(style.align)) ||
        ('effect' in style &&
          ![
            'none',
            'shadow',
            'long-shadow',
            'bevel',
            'emboss',
            'gold',
            'silver',
            'glow',
            'text-stars',
            'text-sand',
            'text-lava',
            'text-lamp',
            'text-slime',
            'text-marble',
            'text-ice',
            'text-retro',
            'text-neon',
            'text-glitch',
            'text-fire',
          ].includes(style.effect)) ||
        ('hidden' in style && typeof style.hidden !== 'boolean')
      )
        throw fail('Invalid text style');
    }
  }
  if ('extraTexts' in data) {
    if (!Array.isArray(data.extraTexts) || data.extraTexts.length > 20) throw fail('Invalid extra texts');
    const ids = new Set();
    for (const item of data.extraTexts) {
      if (
        !item ||
        typeof item !== 'object' ||
        Object.keys(item).some((k) => !['id', 'text', 'y', 'size', 'style'].includes(k)) ||
        !/^extra[0-9a-f-]{36}$/i.test(item.id) ||
        ids.has(item.id) ||
        typeof item.text !== 'string' ||
        item.text.length > 300 ||
        !Number.isFinite(item.y) ||
        item.y < 0 ||
        item.y > 1 ||
        !Number.isFinite(item.size) ||
        item.size < 8 ||
        item.size > 500 ||
        !item.style
      )
        throw fail('Invalid extra text');
      ids.add(item.id);
      validateCoverComposition({ textStyles: { title: item.style } });
    }
  }
  if ('decoration' in data) {
    const d = data.decoration;
    if (
      !d ||
      Object.keys(d).some((k) => !['texture', 'opacity'].includes(k)) ||
      !['none', 'stars', 'sand', 'paper', 'mist'].includes(d.texture) ||
      !Number.isFinite(d.opacity) ||
      d.opacity < 0 ||
      d.opacity > 0.5
    )
      throw fail('Invalid decoration');
  }
  if (/"(?:__proto__|constructor|prototype)"\s*:/.test(JSON.stringify(data)))
    throw fail('Invalid object key');
  return { ...data };
}

function validateProject(data, partial = false) {
  const allowed = new Set([
    'name',
    'type',
    'category',
    'status',
    'content',
    'ingredients',
    'traits',
    'covers',
    'currentCoverIndex',
    'lastCharacterImage',
    'characterImageGeneration',
    'characterImageTrash',
    'characterVisualLibrary',
    'characterMediaDeletions',
    'lastCoverPrompt',
    'lastCoverGenerationMode',
    'coverVersions',
    'production',
    'updatedAt',
  ]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail('Invalid project');
  for (const key of Object.keys(data)) if (!allowed.has(key)) throw fail(`Unknown project field: ${key}`);
  if (!partial && !['name', 'type', 'category'].every((k) => typeof data[k] === 'string' && data[k].trim()))
    throw fail('Name, type and category are required');
  const result = { ...data };
  for (const key of [
    'name',
    'category',
    'status',
    'lastCoverPrompt',
    'lastCoverGenerationMode',
    'updatedAt',
  ]) {
    if (
      key in result &&
      (typeof result[key] !== 'string' || result[key].length > (key === 'lastCoverPrompt' ? 20000 : 300))
    )
      throw fail(`Invalid ${key}`);
  }
  if ('type' in result && !['book', 'character', 'stage', 'song', 'video'].includes(result.type))
    throw fail('Invalid project type');
  if ('content' in result) {
    if (typeof result.content !== 'string' || result.content.length > 5_000_000)
      throw fail('Invalid content');
    let character, scenario, film;
    try {
      character = parseCharacterDocument(result.content);
      scenario = character ? null : parseScenarioDocument(result.content);
      film = character || scenario ? null : parseFilmDocument(result.content);
    } catch (error) {
      throw fail(error.message);
    }
    if (!character && !scenario && !film && result.content.length > 2_000_000) throw fail('Invalid content');
    result.content = character
      ? JSON.stringify(character)
      : scenario
        ? JSON.stringify(scenario)
        : film
          ? JSON.stringify(film)
          : validateScreenplayContent(result.content) ||
            validateStoryBookContent(result.content) ||
            cleanHTML(result.content);
  }
  if ('ingredients' in result) require('./validation.cjs').ingredients(result.ingredients);
  if ('traits' in result) require('./validation.cjs').traits(result.traits);
  if ('production' in result) {
    const production = result.production;
    if (!production || typeof production !== 'object' || Array.isArray(production))
      throw fail('Invalid production plan');
    const productionKeys = new Set([
      'scenes',
      'voiceover',
      'soundtrack',
      'styles',
      'vfx',
      'scriptProjectId',
      'scriptProjectName',
    ]);
    for (const key of Object.keys(production))
      if (!productionKeys.has(key)) throw fail('Invalid production field');
    if (
      'voiceover' in production &&
      (typeof production.voiceover !== 'string' || production.voiceover.length > 20000)
    )
      throw fail('Invalid voiceover');
    if (
      'soundtrack' in production &&
      (typeof production.soundtrack !== 'string' || production.soundtrack.length > 300)
    )
      throw fail('Invalid soundtrack');
    if (
      'scriptProjectId' in production &&
      (typeof production.scriptProjectId !== 'string' || !UUID.test(production.scriptProjectId))
    )
      throw fail('Invalid script project');
    if (
      'scriptProjectName' in production &&
      (typeof production.scriptProjectName !== 'string' || production.scriptProjectName.length > 300)
    )
      throw fail('Invalid script project name');
    if (
      'styles' in production &&
      (!Array.isArray(production.styles) ||
        production.styles.length > 12 ||
        production.styles.some((value) => typeof value !== 'string' || value.length > 80))
    )
      throw fail('Invalid production styles');
    if (
      'vfx' in production &&
      (!production.vfx ||
        typeof production.vfx !== 'object' ||
        Array.isArray(production.vfx) ||
        Object.keys(production.vfx).some(
          (key) =>
            !['parallax', 'glitch', 'particles'].includes(key) || typeof production.vfx[key] !== 'boolean',
        ))
    )
      throw fail('Invalid VFX settings');
    if ('scenes' in production) {
      if (!Array.isArray(production.scenes) || production.scenes.length > 200)
        throw fail('Invalid production scenes');
      const sceneIds = new Set();
      for (const scene of production.scenes) {
        if (!scene || typeof scene !== 'object' || Array.isArray(scene))
          throw fail('Invalid production scene');
        if (
          Object.keys(scene).some(
            (key) =>
              ![
                'id',
                'title',
                'duration',
                'prompt',
                'status',
                'script',
                'source',
                'sourceScene',
                'shots',
                'sourceRemoved',
              ].includes(key),
          )
        )
          throw fail('Invalid production scene field');
        if (
          typeof scene.id !== 'string' ||
          scene.id.length > 80 ||
          typeof scene.title !== 'string' ||
          scene.title.length > 300 ||
          (scene.duration !== null &&
            (!Number.isInteger(scene.duration) || scene.duration < 1 || scene.duration > 600))
        )
          throw fail('Invalid production scene');
        if (!scene.id.trim() || sceneIds.has(scene.id))
          throw fail('Las escenas deben tener identificadores únicos');
        sceneIds.add(scene.id);
        if (scene.source !== undefined) {
          const source = scene.source;
          if (
            !source ||
            typeof source !== 'object' ||
            Array.isArray(source) ||
            Object.keys(source).some(
              (key) =>
                ![
                  'projectId',
                  'projectName',
                  'sceneId',
                  'source',
                  'versionId',
                  'versionNumber',
                  'revision',
                ].includes(key),
            ) ||
            !UUID.test(source.projectId) ||
            typeof source.sceneId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,140}$/.test(source.sceneId) ||
            !['version', 'draft', 'saved'].includes(source.source) ||
            (source.source === 'version' && !UUID.test(source.versionId)) ||
            (source.source !== 'version' && source.versionId !== undefined) ||
            (source.versionNumber !== undefined &&
              (source.source !== 'version' ||
                !Number.isInteger(source.versionNumber) ||
                source.versionNumber < 1)) ||
            (source.projectName !== undefined &&
              (typeof source.projectName !== 'string' || source.projectName.length > 300)) ||
            (source.revision !== undefined && (!Number.isInteger(source.revision) || source.revision < 0))
          )
            throw fail('Invalid production source');
        }
        if (scene.sourceRemoved !== undefined && typeof scene.sourceRemoved !== 'boolean')
          throw fail('Invalid production source state');
        if (scene.sourceScene !== undefined) {
          const doc = screenplaySceneDocument(scene.sourceScene);
          scene.sourceScene = JSON.parse(validateScreenplayContent(JSON.stringify(doc))).scenes[0];
        }
        if (scene.shots !== undefined) {
          if (!Array.isArray(scene.shots) || scene.shots.length > 100) throw fail('Invalid production shots');
          const shotIds = new Set();
          for (const shot of scene.shots) {
            if (
              !shot ||
              typeof shot !== 'object' ||
              Array.isArray(shot) ||
              Object.keys(shot).some(
                (key) => !['id', 'title', 'duration', 'prompt', 'status', 'images'].includes(key),
              ) ||
              typeof shot.id !== 'string' ||
              !/^[A-Za-z0-9_-]{1,80}$/.test(shot.id) ||
              shotIds.has(shot.id) ||
              typeof shot.title !== 'string' ||
              shot.title.length > 300 ||
              typeof shot.prompt !== 'string' ||
              shot.prompt.length > 10000 ||
              typeof shot.status !== 'string' ||
              shot.status.length > 40 ||
              (shot.duration !== null &&
                (!Number.isInteger(shot.duration) || shot.duration < 1 || shot.duration > 600)) ||
              (shot.images !== undefined &&
                (!Array.isArray(shot.images) ||
                  shot.images.length > 100 ||
                  shot.images.some(
                    (url) => typeof url !== 'string' || !/^(\/projects\/|https:\/\/)/.test(url),
                  )))
            )
              throw fail('Invalid production shot');
            shotIds.add(shot.id);
          }
        }
        if ('prompt' in scene && (typeof scene.prompt !== 'string' || scene.prompt.length > 10000))
          throw fail('Invalid production scene prompt');
        if ('script' in scene && (typeof scene.script !== 'string' || scene.script.length > 50000))
          throw fail('Invalid production scene script');
        if ('status' in scene && (typeof scene.status !== 'string' || scene.status.length > 40))
          throw fail('Invalid production scene status');
      }
    }
  }
  if (
    'covers' in result &&
    (!Array.isArray(result.covers) ||
      result.covers.length > 100 ||
      result.covers.some((u) => typeof u !== 'string' || !/^(\/projects\/|https:\/\/)/.test(u)))
  )
    throw fail('Invalid covers');
  if (
    'currentCoverIndex' in result &&
    (!Number.isInteger(result.currentCoverIndex) ||
      result.currentCoverIndex < -1 ||
      result.currentCoverIndex > 100)
  )
    throw fail('Invalid cover index');
  if (
    'lastCharacterImage' in result &&
    (typeof result.lastCharacterImage !== 'string' ||
      result.lastCharacterImage.length > 500 ||
      (result.lastCharacterImage !== '' &&
        !/^\/projects\/[A-Za-z0-9_-]{1,140}\/content\/[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.(png|jpe?g|webp|gif|bmp)$/i.test(
          result.lastCharacterImage,
        )))
  )
    throw fail('Invalid character image reference');
  if ('characterImageGeneration' in result) {
    try {
      result.characterImageGeneration = validateImageEngine(result.characterImageGeneration);
    } catch {
      throw fail('Invalid character image engine');
    }
  }
  if ('characterVisualLibrary' in result) {
    try {
      result.characterVisualLibrary = validateCharacterVisualLibrary(
        result.characterVisualLibrary,
        result.id,
      );
    } catch {
      throw fail('Biblioteca visual de personaje inválida.');
    }
  }
  if (
    'characterMediaDeletions' in result &&
    (!Array.isArray(result.characterMediaDeletions) ||
      result.characterMediaDeletions.length > 5000 ||
      new Set(result.characterMediaDeletions).size !== result.characterMediaDeletions.length ||
      result.characterMediaDeletions.some(
        (url) =>
          typeof url !== 'string' ||
          !/^\/projects\/[A-Za-z0-9_-]{1,140}\/content\/[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.(png|jpe?g|webp|gif|bmp)$/i.test(
            url,
          ),
      ))
  )
    throw fail('Registro de eliminación inválido.');
  if (
    'characterImageTrash' in result &&
    (!Array.isArray(result.characterImageTrash) ||
      result.characterImageTrash.length > 500 ||
      new Set(result.characterImageTrash).size !== result.characterImageTrash.length ||
      result.characterImageTrash.some(
        (url) =>
          typeof url !== 'string' ||
          !/^\/projects\/[A-Za-z0-9_-]{1,140}\/content\/[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.(png|jpe?g|webp|gif|bmp)$/i.test(
            url,
          ),
      ))
  )
    throw fail('Invalid character image trash');
  if ('coverVersions' in result) {
    if (!Array.isArray(result.coverVersions) || result.coverVersions.length > 100)
      throw fail('Invalid cover versions');
    const ids = new Set();
    result.coverVersions = result.coverVersions.map((version) => {
      if (!version || typeof version !== 'object' || Array.isArray(version))
        throw fail('Invalid cover version');
      const allowedVersion = new Set([
        'id',
        'mode',
        'version',
        'finalUrl',
        'backgroundUrl',
        'compositionUrl',
        'title',
        'tagline',
        'author',
        'width',
        'height',
        'createdAt',
      ]);
      if (Object.keys(version).some((key) => !allowedVersion.has(key)))
        throw fail('Invalid cover version field');
      if (typeof version.id !== 'string' || version.id.length > 80 || ids.has(version.id))
        throw fail('Invalid cover version id');
      ids.add(version.id);
      if (!['local', 'api'].includes(version.mode)) throw fail('Invalid cover version mode');
      if (!Number.isSafeInteger(version.version) || version.version < 1)
        throw fail('Invalid cover version number');
      if (typeof version.finalUrl !== 'string' || !/^(\/projects\/|https:\/\/)/.test(version.finalUrl))
        throw fail('Invalid cover version final URL');
      for (const key of ['backgroundUrl', 'compositionUrl'])
        if (key in version && (typeof version[key] !== 'string' || !/^\/projects\//.test(version[key])))
          throw fail(`Invalid cover version ${key}`);
      for (const key of ['title', 'tagline', 'author'])
        if (
          key in version &&
          (typeof version[key] !== 'string' || version[key].length > (key === 'title' ? 300 : 200))
        )
          throw fail(`Invalid cover version ${key}`);
      for (const key of ['width', 'height'])
        if (key in version && (!Number.isInteger(version[key]) || version[key] < 256 || version[key] > 4096))
          throw fail(`Invalid cover version ${key}`);
      if ('createdAt' in version && (typeof version.createdAt !== 'string' || version.createdAt.length > 80))
        throw fail('Invalid cover version timestamp');
      return { ...version };
    });
  }
  // Forbid prototype keys at every level, including serialized ingredient data.
  if (/"(?:__proto__|constructor|prototype)"\s*:/.test(JSON.stringify(result)))
    throw fail('Invalid object key');
  return result;
}

function containedPath(root, ...parts) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw fail('Path outside project storage');
  // A junction/symlink must not redirect a valid-looking path outside storage.
  let current = base;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw fail('Symbolic links are not permitted');
  }
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink())
    throw fail('Storage cannot be a symbolic link');
  return target;
}

function redact(value, secrets = []) {
  if (typeof value === 'string') {
    let text = value.replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
    for (const secret of secrets)
      if (typeof secret === 'string' && secret.length > 3) text = text.split(secret).join('[REDACTED]');
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(authorization|api.?key|token|cookie)$/i.test(k) ? '[REDACTED]' : redact(v, secrets),
      ]),
    );
  return value;
}

function installLocalSecurity(app, port) {
  const session = crypto.randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const localPort = req.socket.localPort || port;
    const hosts = new Set([`localhost:${localPort}`, `127.0.0.1:${localPort}`]);
    if (!hosts.has(req.headers.host)) return res.status(403).json({ error: 'Local host required' });
    const origin = req.headers.origin;
    if (
      (origin && origin !== `http://${req.headers.host}`) ||
      ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])
    )
      return res.status(403).json({ error: 'Same-origin access required' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.locals.nonce = crypto.randomBytes(18).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'nonce-${res.locals.nonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
    next();
  });
  app.get('/api/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.cookie('kai_session', session, { httpOnly: true, sameSite: 'strict', path: '/' });
    res.json({ ready: true });
  });
  app.use(['/api', '/projects'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const cookie = (req.headers.cookie || '')
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('kai_session='))
      ?.slice(12);
    if (cookie !== session) return res.status(401).json({ error: 'Local session required' });
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      ((req.headers['x-kubrick-space'] !== 'local' &&
        req.headers['x-kubrick-studio'] !== 'local' &&
        req.headers['x-code-kai'] !== 'local') ||
        !req.is('application/json'))
    )
      return res.status(403).json({ error: 'Invalid local request' });
    next();
  });
  const generations = { active: 0, calls: [] };
  const localControls = { active: 0, calls: [] };
  app.use('/api/ai', (req, res, next) => {
    if (req.path === '/local-runtime' && ['GET', 'HEAD'].includes(req.method)) return next();
    const control = req.path === '/local-runtime' && req.method === 'POST';
    const bucket = control ? localControls : generations;
    const now = Date.now();
    bucket.calls = bucket.calls.filter((t) => now - t < 60_000);
    if (bucket.active >= 3 || bucket.calls.length >= (control ? 10 : 20))
      return res.status(429).json({
        error: control
          ? 'Demasiados controles del motor local. Espera antes de reintentar.'
          : 'Too many generations. Wait before retrying.',
      });
    bucket.active++;
    bucket.calls.push(now);
    let finished = false;
    const release = () => {
      if (!finished) {
        finished = true;
        bucket.active--;
      }
    };
    res.once('finish', release);
    const send = res.json.bind(res);
    res.json = (data) => {
      release();
      return send(data);
    };
    next();
  });
}

module.exports = {
  validateScreenplayContent,
  UUID,
  IMAGE_NAME,
  MAX_IMAGE_BYTES,
  fail,
  cleanHTML,
  validateStoryBookContent,
  validateProject,
  validateCoverComposition,
  containedPath,
  decodeImage,
  imageType,
  redact,
  installLocalSecurity,
};
