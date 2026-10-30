const { validateIngredients: ingredients } = require('../../../public/js/contracts/ingredients.js');
const { fail, UUID } = require('./primitives.cjs');
const { validateImageEngine } = require('../../../public/js/contracts/project-inference.js');
const {
  CHARACTER_MANNEQUIN_REFERENCES,
} = require('../../../public/js/contracts/character-visual-library.js');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function object(value, keys, label) {
  if (!isObject(value)) throw fail(`${label}: se esperaba un objeto`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw fail(`${label}: campo no permitido (${key})`);
}
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max)
    throw fail(`${label}: texto inválido o demasiado largo (máximo ${max})`);
}
function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw fail(`${label}: número fuera de rango`);
}
function array(value, max, label, check) {
  if (!Array.isArray(value) || value.length > max) throw fail(`${label}: lista inválida (máximo ${max})`);
  value.forEach(check);
}
function traits(value) {
  object(
    value,
    ['age', 'skin', 'body', 'voice', 'pitch', 'pseudonyms', 'lore', 'psychology', 'clothing'],
    'Rasgos',
  );
  for (const [key, item] of Object.entries(value)) {
    if (key === 'age') number(item, 0, 10000, 'Edad');
    else if (key === 'body') number(item, 1, 5, 'Complexión');
    else if (key === 'pitch') number(item, 0, 20000, 'Frecuencia');
    else text(item, ['skin', 'voice'].includes(key) ? 100 : 100000, `Rasgo ${key}`);
  }
}

function boundedJSON(value, depth = 0) {
  if (depth > 10) throw fail('Datos demasiado anidados');
  if (typeof value === 'string') return text(value, 2000000, 'Dato');
  if (typeof value === 'number') return number(value, -1e9, 1e9, 'Dato');
  if (value === null || typeof value === 'boolean') return;
  if (Array.isArray(value)) return array(value, 500, 'Datos', (item) => boundedJSON(item, depth + 1));
  if (!isObject(value) || Object.keys(value).length > 100) throw fail('Datos inválidos');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fail('Clave no permitida');
    boundedJSON(item, depth + 1);
  }
}
function tags(value) {
  array(value, 500, 'Etiquetas', (item) => {
    if (typeof item === 'string') return text(item, 10000, 'Etiqueta');
    object(item, ['term', 'definition'], 'Etiqueta');
    text(item.term, 1000, 'Término');
    if (item.definition !== undefined) text(item.definition, 10000, 'Definición');
  });
}
function blocks(value) {
  array(value, 500, 'Bloques', (item) => text(item, 2000000, 'Bloque'));
}
function context(value) {
  object(value, ['content', 'tags', 'blocks', 'ingredients'], 'Contexto');
  if (value.content !== undefined) text(value.content, 2000000, 'Contenido');
  if (value.tags !== undefined) tags(value.tags);
  if (value.blocks !== undefined) blocks(value.blocks);
  if (value.ingredients !== undefined) ingredients(value.ingredients);
}
function validateAI(route, body) {
  if (
    body?.stream !== undefined &&
    (route !== 'text' ||
      typeof body.stream !== 'boolean' ||
      !body.message ||
      body.instruction ||
      (body.action && body.action !== 'chat'))
  )
    throw fail('Streaming disponible solo para el chat');
  const common = ['projectId', 'options'];
  const fields = {
    text: [
      'promptVariables',
      'stream',
      'instruction',
      'action',
      'length',
      'content',
      'selectedText',
      'tags',
      'blocks',
      'ingredients',
      'message',
      'project',
      'context',
      'history',
      'messages',
      'prompt',
      'coverReferenceIds',
      'coverReferenceNames',
    ],
    image: ['prompt', 'imageType', 'inputImages', 'backend', 'provider', 'model', 'aspectRatio'],
    'local-runtime': ['action', 'model'],
    'character-visual-library': ['document', 'sourceImage'],
    'character-image-prompt': [
      'document',
      'purpose',
      'referenceImage',
      'attachmentImage',
      'visualChangeKeys',
      'photoReferences',
      'assetSelection',
    ],
    video: ['version', 'input'],
    'image-flux': ['version', 'input'],
    multimodal: ['contents', 'prompt'],
    audio: ['prompt', 'text', 'voice', 'model', 'input'],
    'character-design': [
      'document',
      'request',
      'source',
      'ingredients',
      'referenceImage',
      'attachmentImage',
      'selections',
      'gallery',
    ],
  };
  if (!fields[route]) throw fail('Ruta de IA desconocida', 404);
  if (body.gallery !== undefined)
    array(body.gallery, 100, 'Galería', (url) => {
      text(url, 500, 'Foto de galería');
      if (
        !url.startsWith(`/projects/${body.projectId}/content/`) ||
        !/^\/projects\/[0-9a-f-]+\/content\/[\w.-]+\.(png|jpe?g|webp|gif|bmp)$/i.test(url)
      )
        throw fail('La foto de galería debe pertenecer al personaje.');
    });
  if (body.photoReferences !== undefined) {
    try {
      require('../../../public/js/contracts/character-model.js').validateCharacterPhotoReferences(
        body.photoReferences,
        body.projectId,
      );
    } catch (error) {
      throw fail(error.message);
    }
  }
  object(
    body,
    [
      ...common,
      ...fields[route],
      ...(route === 'text' ? ['contextSessionId', 'contextVersion', 'contextScope', 'target'] : []),
    ],
    'Petición de IA',
  );
  if (body.contextSessionId !== undefined) {
    if (
      !UUID.test(body.contextSessionId) ||
      !UUID.test(body.projectId || '') ||
      !/^[a-f0-9]{64}$/.test(body.contextVersion || '')
    )
      throw fail('Sesión de contexto inválida');
  }
  if (body.contextScope !== undefined && !['project', 'selection'].includes(body.contextScope))
    throw fail('Alcance de contexto inválido');
  if (body.coverReferenceIds !== undefined)
    array(body.coverReferenceIds, 8, 'Referencias de portada', (item) => {
      text(item, 100, 'Referencia de portada');
      if (!UUID.test(item)) throw fail('ID de referencia de portada inválido');
    });
  if (body.coverReferenceNames !== undefined)
    array(body.coverReferenceNames, 8, 'Nombres de referencia de portada', (item) =>
      text(item, 300, 'Nombre de referencia de portada'),
    );
  if (body.target !== undefined) {
    object(body.target, ['nodeId', 'before', 'after'], 'Objetivo de IA');
    for (const [key, val] of Object.entries(body.target))
      text(val, key === 'nodeId' ? 300 : 2000000, 'Objetivo de IA');
  }
  if (route === 'text' && JSON.stringify(body).length > 8000000)
    throw fail('El contexto de IA supera 8 millones de caracteres', 413);
  if (body.projectId !== undefined && !UUID.test(body.projectId)) throw fail('Proyecto de IA inválido');
  if (route === 'character-design') {
    if (body.referenceImage !== undefined) text(body.referenceImage, 500, 'Imagen de referencia');
    if (body.attachmentImage !== undefined) text(body.attachmentImage, 500, 'Fotografía adjunta');
    if (body.selections !== undefined)
      array(body.selections, 80, 'Opciones de personaje', (item) => {
        object(item, ['group', 'choice'], 'Opción de personaje');
        text(item.group, 100, 'Grupo');
        text(item.choice, 100, 'Selección');
      });
  }
  for (const key of ['instruction', 'content', 'selectedText', 'message', 'prompt', 'text'])
    if (body[key] !== undefined)
      text(body[key], ['content', 'selectedText'].includes(key) ? 2000000 : 100000, key);
  for (const key of ['action', 'length', 'voice', 'model'])
    if (body[key] !== undefined) text(body[key], 100, key);
  if (body.tags !== undefined) tags(body.tags);
  if (body.blocks !== undefined) blocks(body.blocks);
  if (body.ingredients !== undefined) ingredients(body.ingredients);
  if (body.context !== undefined) context(body.context);
  if (body.project !== undefined && body.project !== null) {
    object(body.project, ['id', 'name', 'type', 'category'], 'Proyecto');
    for (const [key, val] of Object.entries(body.project)) text(val, 300, key);
    if (!UUID.test(body.project.id)) throw fail('ID de proyecto inválido');
  }
  for (const key of ['history', 'messages'])
    if (body[key] !== undefined)
      array(body[key], 100, key, (item) => {
        object(item, ['role', 'content', 'text'], key);
        if (!['user', 'assistant', 'system', 'ai'].includes(item.role)) throw fail('Rol inválido');
        if (item.content === undefined && item.text === undefined) throw fail('Mensaje vacío');
        if (item.content !== undefined) text(item.content, 2000000, 'Mensaje');
        if (item.text !== undefined) text(item.text, 2000000, 'Mensaje');
      });
  if (body.options !== undefined) {
    object(body.options, ['temperature', 'top_p', 'max_tokens', 'max_completion_tokens'], 'Opciones');
    for (const [key, val] of Object.entries(body.options)) {
      const tokenKey = key === 'max_tokens' || key === 'max_completion_tokens';
      number(val, tokenKey ? 1 : 0, tokenKey ? 128000 : key === 'temperature' ? 2 : 1, key);
      if (tokenKey && !Number.isInteger(val)) throw fail(`${key} debe ser entero`);
    }
  }
  if (body.backend !== undefined && !['api', 'local'].includes(body.backend))
    throw fail('Backend de imágenes inválido');
  if (body.provider !== undefined) {
    try {
      validateImageEngine({
        provider: body.provider,
        model: body.model || (body.provider === 'local' ? '' : 'default'),
      });
    } catch {
      throw fail('Proveedor o modelo de imágenes inválido');
    }
  }
  if (body.imageType !== undefined && !['cover', 'character'].includes(body.imageType))
    throw fail('Tipo de imagen inválido');
  if (
    body.aspectRatio !== undefined &&
    !['1:1', '2:3', '3:2', '9:16', '16:9', '3:4', '4:3'].includes(body.aspectRatio)
  )
    throw fail('Proporción de imagen inválida');
  if (body.inputImages !== undefined)
    array(body.inputImages, 8, 'Referencias', (item) => {
      text(item, 22000000, 'Imagen');
      if (CHARACTER_MANNEQUIN_REFERENCES.includes(item)) return;
      if (item.startsWith('data:')) require('./primitives.cjs').decodeImage(item);
      else if (!/^\/projects\/[0-9a-f-]+\/content\/[\w.-]+$/i.test(item)) {
        let url;
        try {
          url = new URL(item);
        } catch {
          throw fail('Referencia de imagen inválida');
        }
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          (url.port && url.port !== '443') ||
          !['images.unsplash.com', 'replicate.delivery'].some(
            (host) => url.hostname === host || url.hostname.endsWith('.' + host),
          )
        )
          throw fail('Importa la imagen al proyecto antes de usarla como referencia');
      }
    });
  if (body.version !== undefined) {
    text(body.version, 100, 'Versión');
    if (body.version && !/^[\da-f]{64}$/i.test(body.version)) throw fail('Versión de modelo inválida');
  }
  if (body.input !== undefined) {
    if (!isObject(body.input)) throw fail('Entrada de modelo inválida');
    boundedJSON(body.input);
  }
  if (body.contents !== undefined)
    array(body.contents, 100, 'Contenido multimodal', (item) => {
      object(item, ['role', 'parts'], 'Contenido multimodal');
      if (item.role !== undefined && !['user', 'model'].includes(item.role))
        throw fail('Rol multimodal inválido');
      array(item.parts, 20, 'Partes', (part) => {
        object(part, ['text', 'inlineData'], 'Parte');
        if (Object.keys(part).length !== 1) throw fail('Parte multimodal inválida');
        if (part.text !== undefined) text(part.text, 2000000, 'Texto');
        else {
          object(part.inlineData, ['mimeType', 'data'], 'Imagen');
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.inlineData.mimeType))
            throw fail('Tipo multimedia inválido');
          require('./primitives.cjs').decodeImage(
            `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
          );
        }
      });
    });
  return body;
}
module.exports = { traits, ingredients, validateAI };
