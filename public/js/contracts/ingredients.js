import { fail, UUID } from './common.js';
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

function array(value, max, label, check) {
  if (!Array.isArray(value) || value.length > max) throw fail(`${label}: lista inválida (máximo ${max})`);
  value.forEach(check);
}

function covers(value) {
  array(value, 100, 'Imágenes', (url) => {
    text(url, 4096, 'URL');
    if (!/^(\/projects\/[0-9a-f-]+\/content\/[\w.-]+|https:\/\/[^\s"'<>]+)$/i.test(url))
      throw fail('URL de imagen inválida');
  });
}

function ingredients(value) {
  array(value, 200, 'Ingredientes', (item) => {
    object(
      item,
      [
        'id',
        'type',
        'label',
        'icon',
        'value',
        'active',
        'color1',
        'color2',
        'importedProjectId',
        'importedProjectName',
        'covers',
        'currentCoverIndex',
        'importedSource',
        'importedVersionId',
        'importedVersionNumber',
        'importedVersionSavedAt',
        'lastAdaptedVersionId',
        'lastAdaptedVersionNumber',
        'lastAdaptedContent',
      ],
      'Ingrediente',
    );
    text(item.type, 100, 'Tipo de ingrediente');
    text(item.label, 300, 'Nombre de ingrediente');
    for (const [key, val] of Object.entries(item)) {
      if (['type', 'label'].includes(key)) continue;
      if (key === 'active') {
        if (typeof val !== 'boolean') throw fail('Ingrediente activo debe ser booleano');
      } else if (key === 'covers') covers(val);
      else if (key === 'currentCoverIndex') {
        if (!Number.isInteger(val) || val < -1 || val > 100) throw fail('Índice de imagen inválido');
      } else if (key === 'importedVersionNumber' || key === 'lastAdaptedVersionNumber') {
        if (!Number.isSafeInteger(val) || val < 1) throw fail('Número de versión inválido');
      } else if (key === 'importedSource') {
        if (!['version', 'draft', 'legacy'].includes(val)) throw fail('Origen del ingrediente inválido');
      } else if (key === 'importedVersionSavedAt') {
        if (typeof val !== 'string' || val.length > 40 || !Number.isFinite(Date.parse(val)))
          throw fail('Fecha de versión inválida');
      } else if (
        key === 'importedProjectId' ||
        key === 'importedVersionId' ||
        key === 'lastAdaptedVersionId'
      ) {
        if (typeof val !== 'string' || !UUID.test(val)) throw fail('Proyecto de ingrediente inválido');
      } else if (key === 'color1' || key === 'color2') {
        if (typeof val !== 'string' || !/^#[\da-f]{3,8}$/i.test(val))
          throw fail('Color de ingrediente inválido');
      } else
        text(
          val,
          ['value', 'lastAdaptedContent'].includes(key) ? 2000000 : key === 'icon' ? 10000 : 300,
          `Ingrediente ${key}`,
        );
    }
    if (item.importedSource && !item.importedProjectId)
      throw fail('La versión requiere un proyecto de origen');
    if (item.importedSource === 'version' && (!item.importedVersionId || !item.importedVersionNumber))
      throw fail('Falta la versión guardada del ingrediente');
    if (
      item.importedSource !== 'version' &&
      (item.importedVersionId || item.importedVersionNumber || item.importedVersionSavedAt)
    )
      throw fail('Metadatos de versión incoherentes');
    if (Boolean(item.lastAdaptedVersionId) !== Boolean(item.lastAdaptedVersionNumber))
      throw fail('Referencia de adaptación incompleta');
    if (
      (item.lastAdaptedVersionId || item.lastAdaptedContent !== undefined) &&
      (item.type !== 'book' || !item.importedProjectId)
    )
      throw fail('Referencia de adaptación inválida');
  });
}
export { ingredients as validateIngredients };
