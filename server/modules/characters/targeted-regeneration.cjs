const {
  characterAssetKind,
  characterAssetSectionName,
  selectedCharacterAssets,
  characterAssetCodeKey,
} = require('../../../public/js/contracts/character-visual-library.js');

const normalize = (text) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const aliases = {
  shoes: ['zapato', 'zapatos', 'calzado', 'botas', 'tenis', 'footwear'],
  hair: ['pelo', 'peinado', 'peinados'],
  beard: ['barba', 'bigote', 'barbas', 'bigotes'],
  glasses: ['gafas', 'lentes'],
};

/** Recognize only a complete, narrow regeneration command. Mixed edits stay with the LLM. */
function targetedRegeneration(request, library, fail) {
  if (typeof request !== 'string' || !library?.items?.length) return null;
  let text = request
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/^por favor[, ]+|[, ]+por favor$/g, '');
  const command =
    /^(?:regenera(?:me|r)?|vuelve a generar|regenerate)\s+(?:(?:solo|solamente|unicamente|únicamente)\s+)?(.+)$/u.exec(
      text,
    );
  if (!command) return null;
  text = command[1];
  let reference = 'portrait';
  const source =
    /\s+(?:usando|con|a partir de)\s+(?:la |esta )?(?:foto(?:grafia)?|imagen)\s+(adjunta|original)$/.exec(
      text,
    );
  if (source) {
    reference = source[1] === 'adjunta' ? 'attachment' : 'original';
    text = text.slice(0, source.index);
  }
  const parts = text.split(/(?:\s*,\s*(?:(?:y|and)\s+)?|\s+(?:y|and)\s+|\s*&\s*)/).filter(Boolean);
  if (!parts.length || parts.length > 24) return null;
  const selected = new Set(selectedCharacterAssets(library).map((item) => item.id));
  const targets = [];
  for (let part of parts) {
    part = part.replace(
      /^(?:(?:las? |los? )?(?:imagenes|fotos|piezas|props) de )?(?:las? |los? |el |la )?/,
      '',
    );
    const matches = library.items.filter((item) => {
      if (item.unavailable) return false;
      if (part.startsWith('#')) return characterAssetCodeKey(item.code) === characterAssetCodeKey(part);
      const kind = characterAssetKind(item);
      const names = [
        kind,
        kind + 's',
        characterAssetSectionName(item),
        item.label,
        ...(aliases[kind] || []),
      ].map(normalize);
      const target = normalize(part);
      return (
        names.includes(target) || names.some((name) => name.endsWith('s') && name.slice(0, -1) === target)
      );
    });
    // Unknown words may express an appearance change or another project: never guess their scope.
    if (!matches.length) return null;
    if (part.startsWith('#') && matches.length > 1)
      throw fail(
        'El código corresponde a varias variantes locales. Indica su ID exacto o selecciona una sola pieza.',
        409,
      );
    const chosen = matches.filter((item) => selected.has(item.id));
    if (!chosen.length && matches.length > 1)
      throw fail(
        'Hay varias variantes de esa pieza. Indica su código # o selecciona las que quieres regenerar.',
        409,
      );
    targets.push(...(chosen.length ? chosen : matches));
  }
  return { reference, items: [...new Map(targets.map((item) => [item.id, item])).values()] };
}
module.exports = { targetedRegeneration };
