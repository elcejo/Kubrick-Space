/**
 * The camera movement of a shot: one choice per clip. The phrase says what the camera does (the path, whether the body
 * moves or only the lens), because H3 follows one named motion at a time; a zoom and a push-in are different moves and
 * are never combined. "auto" leaves the movement to the model, as before. Portable: no DOM, network or storage.
 */
const move = (id, name, icon, hint, phrase = '') => Object.freeze({ id, name, icon, hint, phrase });

export const FILM_MOVEMENTS = Object.freeze([
  move('auto', 'Auto', 'move-auto', 'El modelo elige el movimiento según la acción del plano.'),
  move(
    'static',
    'Static',
    'move-static',
    'Cámara fija: posición y lente no cambian; solo se mueve lo que ocurre en cuadro.',
    'static shot: the camera and the lens do not move at all, only the action moves',
  ),
  move(
    'pan-left',
    'Pan Left',
    'move-pan-left',
    'Panorámica a la izquierda: la cámara gira sobre su eje sin desplazarse.',
    'the camera pans left on a fixed tripod position, turning smoothly without travelling',
  ),
  move(
    'pan-right',
    'Pan Right',
    'move-pan-right',
    'Panorámica a la derecha: la cámara gira sobre su eje sin desplazarse.',
    'the camera pans right on a fixed tripod position, turning smoothly without travelling',
  ),
  move(
    'tilt-up',
    'Tilt Up',
    'move-tilt-up',
    'Cabeceo hacia arriba: la cámara se inclina de abajo arriba sin desplazarse.',
    'the camera tilts up on a fixed position, revealing the scene from low to high',
  ),
  move(
    'tilt-down',
    'Tilt Down',
    'move-tilt-down',
    'Cabeceo hacia abajo: la cámara se inclina de arriba abajo sin desplazarse.',
    'the camera tilts down on a fixed position, revealing the scene from high to low',
  ),
  move(
    'zoom-in',
    'Zoom In',
    'move-zoom-in',
    'Zoom de acercamiento: el cuerpo de la cámara no se mueve y solo cambia la focal.',
    'the camera body stays completely stationary and zooms in; only the focal length changes',
  ),
  move(
    'zoom-out',
    'Zoom Out',
    'move-zoom-out',
    'Zoom de alejamiento: el cuerpo de la cámara no se mueve y solo cambia la focal.',
    'the camera body stays completely stationary and zooms out; only the focal length changes',
  ),
  move(
    'push-in',
    'Push In',
    'move-push-in',
    'Avance: la cámara se desplaza hacia el sujeto y la perspectiva cambia (paralaje).',
    'the camera physically pushes in toward the subject at a slow steady speed, with natural parallax',
  ),
  move(
    'pull-out',
    'Pull Out',
    'move-pull-out',
    'Retroceso: la cámara se aleja del sujeto y la perspectiva cambia (paralaje).',
    'the camera physically pulls back away from the subject at a slow steady speed, with natural parallax',
  ),
  move(
    'tracking',
    'Tracking',
    'move-tracking',
    'Seguimiento: la cámara acompaña al sujeto manteniendo la distancia.',
    'the camera tracks the subject, moving with them at the same pace and keeping a constant distance',
  ),
  move(
    'side-tracking',
    'Side Tracking',
    'move-side-tracking',
    'Seguimiento lateral: la cámara avanza en paralelo al sujeto, de perfil.',
    'the camera travels sideways alongside the subject at the same pace, keeping them in profile',
  ),
  move(
    'crane-up',
    'Crane Up',
    'move-crane-up',
    'Grúa hacia arriba: la cámara asciende en arco o en vertical revelando el espacio.',
    'a crane move: the camera rises smoothly in a sweeping arc, revealing more of the space below',
  ),
  move(
    'crane-down',
    'Crane Down',
    'move-crane-down',
    'Grúa hacia abajo: la cámara desciende hacia el sujeto.',
    'a crane move: the camera descends smoothly in an arc toward the subject',
  ),
  move(
    'pedestal-up',
    'Pedestal Up',
    'move-pedestal-up',
    'Elevación vertical: la cámara sube en línea recta sin inclinarse.',
    'the camera rises straight up on a pedestal without tilting, keeping the horizon level',
  ),
  move(
    'pedestal-down',
    'Pedestal Down',
    'move-pedestal-down',
    'Descenso vertical: la cámara baja en línea recta sin inclinarse.',
    'the camera lowers straight down on a pedestal without tilting, keeping the horizon level',
  ),
  move(
    'handheld',
    'Handheld',
    'move-handheld',
    'Cámara en mano: balanceo orgánico y pequeñas correcciones, sensación de presencia.',
    'handheld camera with a subtle organic sway and small corrections, a close, present feel',
  ),
  move(
    'drone-orbit',
    'Drone Orbit',
    'move-drone-orbit',
    'Órbita de dron: la cámara rodea el sujeto desde lo alto en un círculo amplio.',
    'a drone orbit: the camera circles the subject from above in a wide, smooth arc',
  ),
  move(
    'arc',
    'Arc Orbit',
    'move-arc',
    'Arco: la cámara rodea al sujeto a su altura mostrándolo desde otro lado.',
    'the camera arcs around the subject at eye level, revealing them from a new side',
  ),
  move(
    'whip-pan',
    'Whip Pan',
    'move-whip-pan',
    'Barrido rápido: giro veloz con desenfoque de movimiento hacia el siguiente punto.',
    'a fast whip pan with strong motion blur, swinging quickly to a new point of interest',
  ),
  move(
    'rack-focus',
    'Rack Focus',
    'move-rack-focus',
    'Cambio de foco: la cámara no se mueve y el foco pasa de un sujeto a otro.',
    'a rack focus: the camera stays still and the focus shifts from the foreground subject to the background one',
  ),
  move(
    'pov',
    'POV',
    'move-pov',
    'Punto de vista: vemos lo que ve el personaje, con su paso y su mirada.',
    'point-of-view shot: we see through the character’s eyes, with their pace and head movement',
  ),
  move(
    'snorricam',
    'Snorricam',
    'move-snorricam',
    'Snorricam: la cámara va sujeta al cuerpo del personaje; él queda fijo y el mundo se mueve.',
    'a snorricam: the camera is strapped to the character’s body, so they stay fixed in frame while the world moves behind them',
  ),
  move(
    'robot-arm',
    'Robot Arm',
    'move-robot-arm',
    'Brazo robótico: movimiento exacto, rápido y fluido que combina avance, giro y elevación.',
    'a robotic motion-control arm: a precise, fluid move combining a push, a turn and a rise',
  ),
  move(
    'dolly-zoom',
    'Dolly Zoom',
    'move-dolly-zoom',
    'Dolly zoom: la cámara avanza mientras la focal se abre; el fondo se estira alrededor del sujeto.',
    'a dolly zoom: the camera moves in while the lens zooms out, so the subject keeps its size and the background stretches',
  ),
  move(
    'roll',
    'Roll',
    'move-roll',
    'Giro sobre el eje: el horizonte rota lentamente mientras la cámara avanza.',
    'the camera slowly rolls on its lens axis so the horizon rotates as it moves forward',
  ),
]);

/** The names of the movements as a shot of the screenplay writes them (Auto is the absence of a note). */
export const FILM_MOVEMENT_NAMES = Object.freeze(
  FILM_MOVEMENTS.filter((item) => item.id !== 'auto').map((item) => item.name),
);
const plainName = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** The id of the movement a camera note of a shot names (by its name or its id), or "auto" when it names none. */
export function filmMovementFromNote(note) {
  const wanted = plainName(note);
  if (!wanted) return 'auto';
  return (
    FILM_MOVEMENTS.find(
      (item) => item.id !== 'auto' && (plainName(item.name) === wanted || plainName(item.id) === wanted),
    )?.id ?? 'auto'
  );
}
export const isFilmMovement = (value) => FILM_MOVEMENTS.some((item) => item.id === value);
export const filmMovementPhrase = (value) => FILM_MOVEMENTS.find((item) => item.id === value)?.phrase || '';
