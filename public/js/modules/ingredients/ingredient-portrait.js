import { parseCharacterDocument } from '../characters/character-model.js';
import { faceImageUrl } from '../characters/character-face.js';

const current = (covers, index) =>
  covers[typeof index === 'number' ? index : covers.length - 1] || covers[covers.length - 1];

/**
 * The picture that represents a linked ingredient: the main image, or the saved face crop for a
 * humanoid character. `source` is the full image the crop belongs to, for when the crop is missing.
 */
export function ingredientPortrait(ingredient) {
  let source = null;
  let face = false;
  if (ingredient?.type === 'character') {
    face = true;
    try {
      const data = JSON.parse(ingredient.value || '{}');
      const sheet = parseCharacterDocument(data.content || '');
      if (sheet) face = sheet.identity.base === 'humanoid';
      if (data.covers?.length) source = current(data.covers, data.currentCoverIndex);
    } catch (e) {
      /* An unreadable sheet falls back to the ingredient's own covers. */
    }
  }
  if (!source && ingredient?.covers?.length)
    source = current(ingredient.covers, ingredient.currentCoverIndex);
  if (!source) return null;
  return { source, url: face ? faceImageUrl(source) : source, face };
}
