const {
  TEXT_CORRECTION_PROMPT,
  TEXT_EXPANSION_PROMPT,
  TEXT_REWRITE_PROMPT,
  textContinuationPrompt,
  TEXT_EDIT_PROMPT,
  TEXT_CHAT_PROMPT,
  screenplayUpdateInstruction,
  coverArtInstruction,
} = require('../../../public/js/contracts/text-instructions.js');
const fs = require('node:fs');

const MIN_COMPLETION_TOKENS = 1;
const MAX_COMPLETION_TOKENS = 128000;
const MIN_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 1800000;
const FAST_MODEL = 'openai/gpt-5.6-luna';
const PRO_MODEL = 'openai/gpt-5.6-luna-pro';
const FAST_MODEL_ACTIONS = new Set(['corregir', 'chat']);
const {
  CHARACTER_INVENTORY_PROMPT,
  CHARACTER_EXTRACTION_RULES,
  CHARACTER_ASSET_DIRECTION_PROMPT,
  CHARACTER_REVIEW_PROMPT,
  CHARACTER_LORE_PROMPT,
} = require('../../../public/js/contracts/character-instructions.js');
const { CHARACTER_IMAGE_WRITER_PROMPT } = require('../../../public/js/contracts/character-image-prompt.js');
const { CHARACTER_COMPOSITION_PROMPT } = require('../../../public/js/contracts/character-composition.js');
const { characterDonorInventoryPrompt } = require('../../../public/js/contracts/character-instructions.js');
const PROMPT_VARIANTS = Object.freeze({
  chat: [
    {
      label: 'Escritura y revisión agéntica del libro',
      prompt: require('./book-agent.cjs').BOOK_AGENT_PROMPT,
    },
  ],
  character_image_prompt: [
    { label: 'Composición por capas seleccionadas', prompt: CHARACTER_COMPOSITION_PROMPT },
  ],
  character_visual_library: [
    {
      label: 'Extracción desde una fotografía donante',
      prompt: characterDonorInventoryPrompt(['{{categories}}']),
    },
  ],
  portada_prompt_unificado: [
    { label: 'Portada sin tipografía', prompt: coverArtInstruction(false, '{{selectedReferenceRules}}') },
  ],
});
const CHARACTER_FUNCTIONS = new Set([
  'character_visual_library',
  'character_image_prompt',
  'character_asset_direction',
  'character_composition',
  'character_lore',
]);
const PROMPT_SOURCES = Object.freeze({
  corregir: 'public/js/contracts/text-instructions.js#TEXT_CORRECTION_PROMPT',
  expandir: 'public/js/contracts/text-instructions.js#TEXT_EXPANSION_PROMPT',
  reescribir: 'public/js/contracts/text-instructions.js#TEXT_REWRITE_PROMPT',
  continuar: 'public/js/contracts/text-instructions.js#textContinuationPrompt',
  chat: 'server/modules/ai/text-context.cjs + public/js/contracts/text-instructions.js#TEXT_CHAT_PROMPT',
  generate_character: 'public/js/contracts/character-model.js#CHARACTER_ASSISTANT_PROMPT',
  character_visual_library: 'public/js/contracts/character-instructions.js#CHARACTER_INVENTORY_PROMPT',
  character_image_prompt: 'public/js/contracts/character-image-prompt.js#CHARACTER_IMAGE_WRITER_PROMPT',
  character_asset_direction: 'public/js/contracts/character-instructions.js#CHARACTER_ASSET_DIRECTION_PROMPT',
  character_composition: 'public/js/contracts/character-instructions.js#CHARACTER_REVIEW_PROMPT',
  character_lore: 'public/js/contracts/character-instructions.js#CHARACTER_LORE_PROMPT',
  screenplay_context: 'public/js/contracts/text-instructions.js#screenplayUpdateInstruction',
  screenplay_scene:
    'server/modules/ai/context.cjs#prepare + public/js/contracts/text-instructions.js#TEXT_EDIT_PROMPT',
  portada_prompt_unificado: 'public/js/contracts/text-instructions.js#coverArtInstruction',
  character_portrait_prompt: 'server/modules/ai/text-context.cjs#prepareText (compatibilidad)',
  edit: 'public/js/contracts/text-instructions.js#TEXT_EDIT_PROMPT',
});

// This catalog is the source shown in Configuración → LLM. The context,
// selection and task are appended separately at request time. Some visual
// workflows intentionally have a dynamic instruction assembled by editor.js;
// those entries say so explicitly instead of pretending that a short generic
// sentence is the prompt sent to the model.
const PROMPT_DEFINITIONS = Object.freeze([
  {
    id: 'corregir',
    label: 'Corrección ortográfica',
    usage:
      'Editor visual → Generación → Corregir. Se envía únicamente la selección, con etiquetas y definiciones activas para proteger el vocabulario.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: TEXT_CORRECTION_PROMPT,
  },
  {
    id: 'expandir',
    label: 'Expandir texto',
    usage:
      'Editor visual → Generación → Expandir. La selección es el objetivo y el libro completo sirve como referencia de continuidad.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: TEXT_EXPANSION_PROMPT,
  },
  {
    id: 'reescribir',
    label: 'Reescribir texto',
    usage:
      'Editor visual → Generación → Reescribir. La selección es el objetivo y el libro completo sirve como referencia de voz y continuidad.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: TEXT_REWRITE_PROMPT,
  },
  {
    id: 'continuar',
    label: 'Continuar escritura',
    usage:
      'Editor visual → Generación → Continuar. Inserta texto desde el cursor; el libro completo se conserva como referencia y el ancla evita repetir contenido.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: textContinuationPrompt('{{length}}'),
  },
  {
    id: 'chat',
    label: 'Chat del proyecto',
    usage:
      'Asistente principal. Actúa sobre el documento abierto al recibir órdenes; Story Book ejecuta planificación, edición incremental, recursos complementarios y revisión en la cola, sin confirmación previa. El chat comunica preguntas y resultados reales.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: TEXT_CHAT_PROMPT,
  },
  {
    id: 'generate_character',
    label: 'Ayudante de personajes',
    usage:
      'Ficha de personaje → Interpretar, Desde ingredientes o Actualizar descripción. Propone cambios revisables mediante herramientas limitadas a la ficha activa; admite características dinámicas según su base y naturaleza.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: require('../../../public/js/contracts/character-model.js').CHARACTER_ASSISTANT_PROMPT,
  },
  {
    id: 'character_visual_library',
    label: 'Desglosar rasgos, ropa y props',
    status: 'active',
    timeoutKey: 'default',
    usage:
      'Galería Outfit y extracción desde referencias. Recibe imágenes y contrato de inventario; las reglas de extracción y visibilidad siguen siendo obligatorias.',
    defaultPrompt: `${CHARACTER_INVENTORY_PROMPT}\n${CHARACTER_EXTRACTION_RULES}`,
  },
  {
    id: 'character_image_prompt',
    label: 'Dirección visual de personaje',
    status: 'active',
    timeoutKey: 'default',
    usage:
      'Redacta la instrucción visual concreta a partir de la ficha y referencias. La composición por capas añade sus reglas dinámicas obligatorias.',
    defaultPrompt: CHARACTER_IMAGE_WRITER_PROMPT,
  },
  {
    id: 'character_asset_direction',
    label: 'Interpretar una pieza visual',
    status: 'active',
    timeoutKey: 'default',
    usage:
      'Regenerar una pieza desde una referencia: describe el componente exacto, sin cambiar la identidad del personaje.',
    defaultPrompt: CHARACTER_ASSET_DIRECTION_PROMPT,
  },
  {
    id: 'character_composition',
    label: 'Comprobar composición Outfit',
    status: 'active',
    timeoutKey: 'default',
    usage:
      'Comprueba el retrato generado frente a las piezas seleccionadas. No modifica ni regenera imágenes por sí solo.',
    defaultPrompt: CHARACTER_REVIEW_PROMPT,
  },
  {
    id: 'character_lore',
    label: 'Investigar lore de personaje',
    status: 'active',
    timeoutKey: 'default',
    usage:
      'Investigación opcional con búsqueda web del proveedor. Requiere API; el modelo local no dispone de búsqueda web.',
    defaultPrompt: CHARACTER_LORE_PROMPT,
  },
  {
    id: 'screenplay_context',
    label: 'Adaptar a guión',
    usage:
      'Editor de un proyecto Guión → Generar guión desde el contexto. Usa el ingrediente Story-book activo y los demás ingredientes como referencia.',
    status: 'active-dynamic',
    timeoutKey: 'screenplay',
    defaultPrompt: screenplayUpdateInstruction(),
  },
  {
    id: 'screenplay_scene',
    label: 'Actualizar escena de guión',
    usage:
      'Guión → clic derecho → Actualizar esta escena con IA. La propuesta se revisa antes de aplicarla. Recibe el guión como referencia y los ingredientes en sus versiones elegidas; devuelve solo la escena objetivo.',
    status: 'active',
    timeoutKey: 'default',
    defaultPrompt: TEXT_EDIT_PROMPT,
  },
  {
    id: 'portada_prompt_unificado',
    label: 'Dirección artística de portada',
    usage:
      'Story-book o guión → generar portada. Trabajo del servidor con sesión nueva, manuscrito e ingredientes seleccionados; composición y lettering específicos de la obra, título dominante, sin autor. Usa los modelos de la barra superior en Local o API.',
    status: 'active-dynamic',
    timeoutKey: 'cover',
    defaultPrompt: coverArtInstruction(true, '{{selectedReferenceRules}}'),
  },
  {
    id: 'character_portrait_prompt',
    label: 'Retrato de personaje',
    usage:
      'Compatibilidad sin invocación desde la UI actual. La dirección visual vigente está en Dirección visual de personaje, no en esta entrada antigua.',
    status: 'conditional-legacy',
    timeoutKey: 'default',
    defaultPrompt: TEXT_EDIT_PROMPT,
  },
  {
    id: 'edit',
    label: 'Edición libre',
    usage:
      'No hay una acción visible de la interfaz que invoque actualmente «edit». Se conserva como reserva para futuras funciones de edición directa.',
    status: 'unused',
    timeoutKey: 'default',
    defaultPrompt: TEXT_EDIT_PROMPT,
  },
]);

// The system prompt is only the stable instruction. Every request also has a
// dynamic context/task message; exposing that distinction prevents the LLM
// settings screen from suggesting that the manuscript was omitted.
const CONTEXT_DESCRIPTIONS = Object.freeze({
  corregir:
    'El system prompt contiene las reglas de corrección. En mensajes de contexto separados se agregan el texto seleccionado, las etiquetas y definiciones activas y, si existen, los fragmentos protegidos. No se envía el libro completo.',
  expandir:
    'Se agregan el libro completo como referencia, las definiciones e ingredientes activos y el texto seleccionado como objetivo. La respuesta solo sustituye el objetivo.',
  reescribir:
    'Se agregan el libro completo como referencia, las definiciones e ingredientes activos y el texto seleccionado como objetivo. La respuesta solo sustituye el objetivo.',
  continuar:
    'Se agregan el libro completo, las definiciones e ingredientes activos y el ancla exacta del cursor. {{length}} se resuelve con la longitud elegida. La respuesta se inserta desde ese punto.',
  chat: 'Se agregan el proyecto activo, su contexto narrativo, ingredientes y la conversación reciente como mensajes dinámicos. El system prompt no contiene por sí solo esos datos.',
  generate_character:
    'Se agrega la ficha JSON activa y la petición; en el modo Desde ingredientes se incluyen referencias activas. El contrato de herramientas y su validación se aplican siempre, incluso si se personaliza este prompt.',
  screenplay_context:
    'El editor construye dinámicamente la adaptación: el Story-book vinculado, ingredientes activos, reglas de formato y opciones del flujo se envían como contexto de usuario.',
  screenplay_scene:
    'Se agrega el guión como referencia, los ingredientes en sus versiones elegidas y la escena objetivo con identificador. La salida JSON tipada solo puede actualizar esa escena y requiere revisión antes de aplicarse.',
  portada_prompt_unificado:
    'El contexto del proyecto agrega el libro completo y los ingredientes activos; en mensajes separados se incluyen las referencias visuales seleccionadas y el idioma detectado. Cada generación abre una sesión nueva.',
  character_portrait_prompt:
    'Se agrega la ficha del personaje y sus rasgos visuales como tarea; el lore se usa para expresión o postura observable, no como escena ni como texto de imagen.',
  edit: 'No hay una acción visible activa que use esta entrada. Si se habilita, recibirá el texto y la instrucción específica de edición.',
});

const DEFAULT_TIMEOUTS = Object.freeze({ default: 120000, cover: 300000, screenplay: 600000 });
const DEFAULT_MAX_COMPLETION_TOKENS = MAX_COMPLETION_TOKENS;
const DEFAULTS = Object.freeze({
  maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
  timeouts: DEFAULT_TIMEOUTS,
  functions: Object.freeze(
    Object.fromEntries(
      PROMPT_DEFINITIONS.map((definition) => [
        definition.id,
        Object.freeze({
          maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
          // Chat can carry a complete manuscript and active ingredients. Give the
          // agent enough time for large projects and slower user-selected models.
          timeoutMs:
            definition.id === 'chat'
              ? 600000
              : DEFAULT_TIMEOUTS[definition.timeoutKey] || DEFAULT_TIMEOUTS.default,
          model: FAST_MODEL_ACTIONS.has(definition.id) ? FAST_MODEL : PRO_MODEL,
        }),
      ]),
    ),
  ),
  prompts: Object.freeze({}),
});

const definitionMap = new Map(PROMPT_DEFINITIONS.map((definition) => [definition.id, definition]));
const asInteger = (value, fallback, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const isModelId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value);
const isLocalModel = (value) => typeof value === 'string' && value.startsWith('local:');

function normalize(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const prompts = {};
  if (source.prompts && typeof source.prompts === 'object' && !Array.isArray(source.prompts)) {
    for (const definition of PROMPT_DEFINITIONS) {
      const value = source.prompts[definition.id];
      if (typeof value === 'string' && value.trim() && value.length <= 200000)
        prompts[definition.id] = value
          .trim()
          .replace(/\bcode kai\b/gi, 'Kubrick Space')
          .replace(/\bkubrick studio\b/gi, 'Kubrick Space')
          .replace(/\b(Eres|agente|asistente) Kai\b/g, '$1 Kubrick Space');
    }
  }
  const sourceTimeouts =
    source.timeouts && typeof source.timeouts === 'object' && !Array.isArray(source.timeouts)
      ? source.timeouts
      : {};
  const maxCompletionTokens = asInteger(
    source.maxCompletionTokens,
    DEFAULT_MAX_COMPLETION_TOKENS,
    MIN_COMPLETION_TOKENS,
    MAX_COMPLETION_TOKENS,
  );
  const timeouts = {
    default: asInteger(sourceTimeouts.default, DEFAULT_TIMEOUTS.default, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    cover: asInteger(sourceTimeouts.cover, DEFAULT_TIMEOUTS.cover, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    screenplay: asInteger(
      sourceTimeouts.screenplay,
      DEFAULT_TIMEOUTS.screenplay,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
  };
  const sourceFunctions =
    source.functions && typeof source.functions === 'object' && !Array.isArray(source.functions)
      ? source.functions
      : {};
  const functions = {};
  for (const definition of PROMPT_DEFINITIONS) {
    const legacyTimeout = timeouts[definition.timeoutKey] || timeouts.default;
    let configured =
      sourceFunctions[definition.id] &&
      typeof sourceFunctions[definition.id] === 'object' &&
      !Array.isArray(sourceFunctions[definition.id])
        ? sourceFunctions[definition.id]
        : CHARACTER_FUNCTIONS.has(definition.id)
          ? sourceFunctions.generate_character || {}
          : {};
    const inherited =
      CHARACTER_FUNCTIONS.has(definition.id) &&
      (!sourceFunctions[definition.id] || sourceFunctions[definition.id].inheritModel === true);
    if (inherited)
      configured = {
        ...functions.generate_character,
        ...configured,
        model: functions.generate_character.model,
        apiModel: functions.generate_character.apiModel,
      };
    const defaultModel = FAST_MODEL_ACTIONS.has(definition.id) ? FAST_MODEL : PRO_MODEL;
    functions[definition.id] = {
      ...(CHARACTER_FUNCTIONS.has(definition.id) ? { inheritModel: inherited } : {}),
      maxCompletionTokens: asInteger(
        configured.maxCompletionTokens,
        maxCompletionTokens,
        MIN_COMPLETION_TOKENS,
        MAX_COMPLETION_TOKENS,
      ),
      timeoutMs: asInteger(
        configured.timeoutMs,
        definition.id === 'chat' ? DEFAULTS.functions.chat.timeoutMs : legacyTimeout,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      ),
      model: isModelId(configured.model) ? configured.model : defaultModel,
      ...(isLocalModel(configured.model)
        ? {
            apiModel:
              isModelId(configured.apiModel) && !isLocalModel(configured.apiModel)
                ? configured.apiModel
                : defaultModel,
          }
        : {}),
    };
  }
  return { version: 2, maxCompletionTokens, timeouts, functions, prompts };
}

function read(file) {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return normalize();
  }
}

function publicConfig(config) {
  const normalized = normalize(config);
  return {
    version: normalized.version,
    limits: {
      minCompletionTokens: MIN_COMPLETION_TOKENS,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
      minTimeoutMs: MIN_TIMEOUT_MS,
      maxTimeoutMs: MAX_TIMEOUT_MS,
    },
    maxCompletionTokens: normalized.maxCompletionTokens,
    timeouts: normalized.timeouts,
    prompts: Object.fromEntries(
      PROMPT_DEFINITIONS.map((definition) => {
        const limits = normalized.functions[definition.id] || DEFAULTS.functions[definition.id];
        const defaultLimits = DEFAULTS.functions[definition.id];
        return [
          definition.id,
          {
            id: definition.id,
            label: definition.label,
            description: definition.usage,
            usage: definition.usage,
            contextDescription:
              CONTEXT_DESCRIPTIONS[definition.id] ||
              'El editor agrega el contexto necesario en mensajes separados para cada solicitud.',
            status: definition.status,
            promptSource: PROMPT_SOURCES[definition.id] || 'runtime',
            variants: PROMPT_VARIANTS[definition.id] || [],
            defaultPrompt: definition.defaultPrompt,
            prompt: normalized.prompts[definition.id] || definition.defaultPrompt,
            customized: Boolean(normalized.prompts[definition.id]),
            maxCompletionTokens: limits.maxCompletionTokens,
            timeoutMs: limits.timeoutMs,
            model: limits.model,
            apiModel: limits.apiModel || limits.model,
            defaultModel: defaultLimits.model,
            modelCustomized: limits.model !== defaultLimits.model,
            defaultMaxCompletionTokens: defaultLimits.maxCompletionTokens,
            defaultTimeoutMs: defaultLimits.timeoutMs,
          },
        ];
      }),
    ),
  };
}

function prompt(config, action, fallback = '') {
  const normalized = normalize(config);
  return normalized.prompts[action] || fallback || definitionMap.get(action)?.defaultPrompt || '';
}

function functionConfig(config, action) {
  const normalized = normalize(config);
  return (
    normalized.functions[action] || {
      maxCompletionTokens: normalized.maxCompletionTokens,
      timeoutMs: normalized.timeouts.default,
      model: PRO_MODEL,
    }
  );
}
function characterPrompt(config, action, mandatory) {
  const custom = normalize(config).prompts[action];
  return custom && custom !== mandatory ? `${custom}\n\n${mandatory}` : mandatory;
}

module.exports = {
  DEFAULTS,
  MIN_COMPLETION_TOKENS,
  MAX_COMPLETION_TOKENS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  FAST_MODEL,
  PRO_MODEL,
  isModelId,
  isLocalModel,
  CONTEXT_DESCRIPTIONS,
  PROMPT_DEFINITIONS,
  normalize,
  read,
  publicConfig,
  prompt,
  functionConfig,
  characterPrompt,
};
