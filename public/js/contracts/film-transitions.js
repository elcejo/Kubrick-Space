/**
 * The transitions of a shot are the ways a clip of the film joins the one before it (its continuity modes): the same
 * four the film already offers. A shot of the screenplay chooses one in a list and the film inherits it; "auto" is the
 * absence of a note and leaves the choice to the system. Portable: no DOM, network or storage.
 */
/** What each way of joining the previous clip does, as the tooltip of the mode selector says it. */
export const FILM_MODE_HELP = Object.freeze({
  auto: 'Automática: el sistema elige por ti según el guión. Otra escena = escena nueva; otro plano de la misma escena = corte con continuidad. El primer clip de la película no sigue a nadie.',
  take: 'Continuación (misma toma): para un plano que sigue la misma toma que el anterior, sin cambio de cámara (por ejemplo una acción larga que partiste en dos planos). Se genera con 22 fotogramas extra que repiten el final del clip anterior y guían su arranque; esos fotogramas no se reproducen. Necesita el clip anterior de su escena, se genera después de él y queda desactualizado si lo rehaces.',
  cut: 'Corte con continuidad: otro plano de la misma escena con cambio de encuadre (de general a primer plano). El modelo escribe una nota con cómo está la acción al empezar (dónde está cada personaje, su postura, gesto y mirada, y de dónde viene la luz) a partir del final del clip anterior; puedes editarla. Opcionalmente, el último fotograma del anterior viaja como referencia.',
  keyframe:
    'Con fotograma inicial: el modelo de imagen genera un fotograma de arranque para este plano a partir del final del anterior, las fotos de los personajes y el escenario. Lo ves y lo cambias o regeneras antes de gastar GPU en el video, y el video arranca de él. Es el modo con más control; necesita el modelo de imagen de la barra superior.',
  new: 'Escena nueva: otro lugar o momento, sin continuidad de postura ni de gesto con el clip anterior. Solo se conserva el aspecto de la escena (luz, clima, vestuario y objetos).',
});

const transition = (id, name) => Object.freeze({ id, name, hint: FILM_MODE_HELP[id] });

export const FILM_TRANSITIONS = Object.freeze([
  transition('take', 'Continuación (misma toma)'),
  transition('cut', 'Corte con continuidad'),
  transition('keyframe', 'Con fotograma inicial'),
  transition('new', 'Escena nueva'),
]);
/** The names as a shot of the screenplay writes them in its transition field. */
export const FILM_TRANSITION_NAMES = Object.freeze(FILM_TRANSITIONS.map((item) => item.name));
const plainName = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** The continuity mode a transition note of a shot names (by its name or its id), or "auto" when it names none. */
export function filmTransitionFromNote(note) {
  const wanted = plainName(note);
  if (!wanted) return 'auto';
  return (
    FILM_TRANSITIONS.find((item) => plainName(item.name) === wanted || plainName(item.id) === wanted)?.id ??
    'auto'
  );
}
