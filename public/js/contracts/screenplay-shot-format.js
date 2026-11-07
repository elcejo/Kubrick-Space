/**
 * The format of the two blocks of a shot that have a closed list: its technical line and its transition. One text tells
 * the models that write a screenplay what is allowed, and one check reads a block against it, so what the person picks
 * in the lists of the editor and what a model writes are the same thing. Portable: no DOM, network or storage.
 */
import { SCREENPLAY_SHOTS, SCREENPLAY_SHOT_SECONDS } from './screenplay.js';
import { FILM_MOVEMENT_NAMES } from './film-movements.js';
import { FILM_TRANSITION_NAMES } from './film-transitions.js';

const plain = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const seconds = SCREENPLAY_SHOT_SECONDS.join(', ');

/** What a model is told about the technical line and the transition of a shot, in the words of the contract. */
export const SCREENPLAY_SHOT_FORMAT =
  'LÍNEA DEL PLANO (bloque shot): «PLANO N — Encuadre; Movimiento; X s». Encuadre es uno de: ' +
  SCREENPLAY_SHOTS.join(', ') +
  '. Movimiento (de cámara) es opcional y, si se escribe, exactamente uno de: ' +
  FILM_MOVEMENT_NAMES.join(', ') +
  '. X es una duración que H3 admite (17k + 5 fotogramas a 24 por segundo): ' +
  seconds +
  ' (hasta 15 s; no escribas otro valor). TRANSICIÓN (bloque transition): vacío (el sistema decide) o exactamente uno de: ' +
  FILM_TRANSITION_NAMES.join(', ') +
  '; nunca «CORTE A», «FUNDIDO» ni texto libre. La transición une un plano con el anterior, así que el primer plano del guión (el primero de la primera escena) NO lleva transición: va siempre vacía.';

/**
 * Why a shot line or a transition does not follow the format, or an empty string when it does. Other block types are
 * not checked here.
 */
export function shotBlockProblem(type, text) {
  const value = String(text ?? '').trim();
  if (type === 'transition') {
    if (!value || FILM_TRANSITION_NAMES.some((name) => plain(name) === plain(value))) return '';
    return 'La transición debe estar vacía o ser una de: ' + FILM_TRANSITION_NAMES.join(', ') + '.';
  }
  if (type !== 'shot') return '';
  const parts = value
    .replace(/^PLANO\s+\d+\s*(?:[—–:-]\s*)?/i, '')
    .split(/\s*;\s*/)
    .filter(Boolean);
  const [framing, ...rest] = parts;
  if (!framing || !SCREENPLAY_SHOTS.some((name) => plain(name) === plain(framing)))
    return 'El plano debe empezar por un encuadre de: ' + SCREENPLAY_SHOTS.join(', ') + '.';
  const last = rest.at(-1)?.match(/^(\d+(?:[.,]\d+)?)\s*(?:s|seg\.?|segundos?)$/i);
  if (!last) return 'El plano debe terminar con su duración en segundos (por ejemplo «8 s»).';
  if (!SCREENPLAY_SHOT_SECONDS.includes(Number(last[1].replace(',', '.'))))
    return 'La duración del plano debe ser una de: ' + seconds + ' segundos.';
  const movement = rest.slice(0, -1).join('; ');
  if (movement && !FILM_MOVEMENT_NAMES.some((name) => plain(name) === plain(movement)))
    return 'El movimiento de cámara debe estar vacío o ser uno de: ' + FILM_MOVEMENT_NAMES.join(', ') + '.';
  return '';
}
