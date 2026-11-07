/**
 * One shot of the screenplay is one clip of the film, and it lasts what the shot says (fifteen seconds at most). The
 * dialogue is never cut or moved to another clip: when it does not fit the time of the shot at a normal pace, the
 * author is told how many words fit, and decides whether to give the shot more time or to shorten the speech.
 *
 * Portable and pure: no DOM, network or storage.
 */
/** A spoken pace of about 2.3 words per second: 34 words in the fifteen seconds of the longest clip. */
export const FILM_DIALOGUE_WORDS_PER_SECOND = 2.3;

const wordsOf = (text) =>
  String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/** The dialogue words of some blocks. */
export const filmDialogueWords = (blocks) =>
  blocks.filter((block) => block.type === 'dialogue').reduce((sum, block) => sum + wordsOf(block.text), 0);

/** How many spoken words fit in a clip of `seconds`. */
export const filmDialogueCapacity = (seconds) => Math.floor(seconds * FILM_DIALOGUE_WORDS_PER_SECOND);
