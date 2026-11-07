/**
 * The edit plan: before the general assistant changes any asset, the person reads what it is about to do and approves it.
 * A command that only reads (a list, a status, a check of continuity) needs no plan; any command that changes a project,
 * its images, its versions or its ingredients does. The plan is written here from the command already validated against
 * its schema, never by the model, so a small model cannot soften it or hide a change. Portable: no DOM, network or storage.
 */

const quote = (value, max = 280) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
};
const SAFETY_VERSION =
  'Antes de cambiar nada se guarda una versión del estado actual, que se puede restaurar.';

/** Commands and actions that never change an asset, so they run without a plan. */
const READ_ONLY = {
  LEER_PROYECTO: true,
  CONTINUIDAD: true,
  CREAR_PROYECTO: true,
  VERSION: ['list', 'save'],
  PROYECTO: ['list_trash', 'export'],
  PORTADA: ['list'],
  ESCENARIO: ['list_images'],
  PELICULA: ['status', 'cancel'],
};

/** True when the command changes an asset and must be approved first. */
export function needsEditPlan(name, value = {}) {
  if (name === 'EDITAR_PROYECTO' || name === 'PERSONAJE' || name === 'INGREDIENTE') return true;
  const exempt = READ_ONLY[name];
  if (exempt === true) return false;
  if (!exempt) return false;
  return !exempt.includes(value?.action || (name === 'PORTADA' ? 'generate' : ''));
}

const CHARACTER_STEPS = {
  interpret: (v) => [
    `Interpretar tu petición sobre el personaje: «${quote(v.request) || 'sin detalle'}».`,
    'Proponer los cambios de la ficha; los visuales generan una foto nueva y los narrativos conservan la actual.',
  ],
  generate: () => [
    'Generar otra propuesta de apariencia principal para compararla; tú eliges cuál conservar.',
  ],
  retry: () => ['Reintentar solo la fase pendiente de la tarea anterior, sin reinterpretar la petición.'],
  manage: (v) => [`Gestionar fichas y fotos de personajes: «${quote(v.request) || 'acción indicada'}».`],
};
const SCENARIO_STEPS = {
  complete: () => ['Generar solo lo que le falta al escenario: ficha, panorama 360° y los cuatro ángulos.'],
  change: (v) => [`Cambiar el escenario existente: «${quote(v.request) || 'sin detalle'}».`],
  regenerate: (v) => [
    `Rehacer las imágenes del escenario${v.scope === 'view' ? ' (una vista)' : v.scope === 'views' ? ' (varias vistas)' : ''}; las anteriores van a la papelera de imágenes.`,
  ],
  restore_image: () => ['Recuperar una imagen de la papelera del escenario.'],
  add_reference: () => ['Añadir una referencia de imagen al escenario.'],
  remove_reference: () => ['Quitar una referencia de imagen del escenario.'],
  purge_images: () => ['Vaciar para siempre la papelera de imágenes del escenario (no se puede deshacer).'],
};
const FILM_STEPS = {
  generate: () => ['Generar la película desde el guion: planos, prompts y continuidad.'],
  write_prompt: () => ['Escribir con el modelo el prompt de un plano.'],
  retry_failed: () => ['Reintentar los clips que fallaron.'],
  preview: () => ['Previsualizar un plano con el modelo de video local elegido.'],
  final: () => ['Componer el video final de la película.'],
  continuity: () => ['Cambiar el modo de continuidad entre clips.'],
  keyframe: () => ['Cambiar el fotograma clave de un clip.'],
  approve: () => ['Aprobar un plano.'],
  unapprove: () => ['Retirar la aprobación de un plano.'],
  redo: () => ['Rehacer un plano.'],
  retry: () => ['Reintentar el trabajo de la película.'],
};
const INGREDIENT_STEPS = {
  link: () => ['Vincular activos como ingredientes del proyecto.'],
  unlink: () => ['Desvincular activos de los ingredientes del proyecto.'],
  activate: () => ['Activar ingredientes para que el asistente los use.'],
  deactivate: () => ['Desactivar ingredientes.'],
  set_version: () => ['Cambiar la versión de un ingrediente.'],
};
const COVER_STEPS = {
  generate: (v) => [
    `Generar una portada nueva${v.request ? `: «${quote(v.request)}»` : ''}; las anteriores se conservan en el historial.`,
  ],
  select: () => ['Elegir otra portada del historial como la actual.'],
  delete: () => ['Eliminar una portada para siempre (no se puede deshacer).'],
};
const PROJECT_STEPS = {
  rename: (v) => [`Renombrar el proyecto a «${quote(v.name, 120)}».`],
  trash: () => ['Enviar el proyecto a la papelera.'],
  restore: () => ['Restaurar el proyecto desde la papelera.'],
};
const VERSION_STEPS = { restore: () => ['Restaurar una versión guardada como borrador actual.'] };

const TITLES = {
  EDITAR_PROYECTO: 'Editar el contenido',
  PERSONAJE: 'Cambiar un personaje',
  ESCENARIO: 'Cambiar un escenario',
  PELICULA: 'Cambiar el largometraje',
  INGREDIENTE: 'Cambiar ingredientes',
  PORTADA: 'Cambiar portadas',
  PROYECTO: 'Cambiar un proyecto',
  VERSION: 'Restaurar una versión',
};

/**
 * The plan of a command, or null when it needs none.
 * `context`: { projectName, request (what the person wrote), paragraph (selected element, optional), assistantText }.
 * Returns { key, title, target, steps[], safety, assistantNote } where `key` identifies the plan for this request.
 */
export function editPlan(name, value = {}, context = {}) {
  if (!needsEditPlan(name, value)) return null;
  const action = value?.action || (name === 'PORTADA' ? 'generate' : '');
  let steps;
  if (name === 'EDITAR_PROYECTO') {
    steps = [
      'Leer el proyecto completo.',
      `Aplicar tu petición: «${quote(context.request) || 'sin detalle'}».`,
      context.paragraph
        ? `Limitar el cambio al elemento seleccionado (${context.paragraph.kind || 'elemento'}).`
        : 'Editar solo lo que tu petición pide; el resto se conserva.',
      'Dejar el resultado en el borrador, con opción de deshacer.',
    ];
  } else {
    const table = {
      PERSONAJE: CHARACTER_STEPS,
      ESCENARIO: SCENARIO_STEPS,
      PELICULA: FILM_STEPS,
      INGREDIENTE: INGREDIENT_STEPS,
      PORTADA: COVER_STEPS,
      PROYECTO: PROJECT_STEPS,
      VERSION: VERSION_STEPS,
    }[name];
    steps = (table?.[action] || (() => [`Ejecutar «${name}» (${action || 'sin acción'}).`]))(value);
  }
  const destructive = steps.some((step) => /para siempre|papelera/.test(step));
  const extraTarget = Array.isArray(value?.projectIds) && value.projectIds.length > 1;
  return {
    key: `${name}:${action}:${quote(context.request, 80)}:${name === 'EDITAR_PROYECTO' ? '' : value?.projectId || ''}`,
    title: TITLES[name] || 'Cambiar el proyecto',
    target: extraTarget
      ? `${value.projectIds.length} elementos`
      : context.projectName
        ? `«${quote(context.projectName, 80)}»`
        : 'el proyecto abierto',
    steps,
    safety:
      name === 'EDITAR_PROYECTO' ? SAFETY_VERSION : destructive ? 'Esta acción no se puede deshacer.' : '',
    assistantNote: quote(context.assistantText, 600),
  };
}

/** The plan as plain text, for the conversation history (it is what the person and the model both read later). */
export function editPlanText(plan) {
  return [
    `**Plan de edición — ${plan.title}** (${plan.target})`,
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
    ...(plan.safety ? [`_${plan.safety}_`] : []),
    '',
    'No haré ningún cambio hasta que lo apruebes.',
  ].join('\n');
}

export const EDIT_PLAN_CHOICES = Object.freeze({
  approve: 'Aprobar y editar',
  analyze: 'Solo analizar',
  cancel: 'Cancelar',
});

/** What the model is told when the person declines the edit but still wants an answer. */
export const EDIT_PLAN_ANALYZE_ONLY =
  '[Sistema: la persona NO aprobó el plan de edición. No edites ni emitas comandos que cambien nada. Responde solo con análisis, explicación o preguntas, sin modificar ningún asset.]';
