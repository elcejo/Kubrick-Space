/**
 * The rule of the general assistant: it can do whatever a person can do by hand in any project. This is the register of
 * what a person can do in each kind of project and how the assistant does it, so that what is missing is a list and not a
 * recollection. A row is "covered" only when it names the operation or command that does it, and a test checks that those
 * exist; a row that is "missing" says in which batch it will be done. The document published from it is generated.
 *
 * The rows come from the document contracts of each kind (what a person can change in the document) and from the
 * workspaces' modules; a row is confirmed against the interface when it is implemented.
 */
export const ASSISTANT_PARITY_VERSION = 1;

/** The kinds of project the register covers, with the name the documents use for them. */
export const PARITY_KINDS = Object.freeze({
  'story-book': 'Story Book',
  screenplay: 'Guión',
  stage: 'Escenario',
  film: 'Largometraje',
  character: 'Personaje',
  project: 'Cualquier proyecto',
});
export const PARITY_STATUS = Object.freeze({
  covered: 'Cubierto',
  missing: 'Falta',
  excluded: 'Excluido',
});

const covered = (kind, area, capability, via) => ({ kind, area, capability, status: 'covered', via });
/** A row for something a person can do and the assistant cannot yet: it names the batch that will do it. */
export const missing = (kind, area, capability, batch, note = '') => ({
  kind,
  area,
  capability,
  status: 'missing',
  batch,
  ...(note ? { note } : {}),
});

export const ASSISTANT_PARITY = Object.freeze([
  // Story Book
  covered('story-book', 'Texto', 'Escribir y corregir el título, los capítulos, los temas y los párrafos', [
    'replace_text',
  ]),
  covered('story-book', 'Estructura', 'Insertar capítulos, temas y párrafos', [
    'insert_chapter',
    'insert_theme',
    'insert_paragraph',
  ]),
  covered('story-book', 'Estructura', 'Eliminar capítulos, temas y párrafos', ['remove_element']),
  covered('story-book', 'Línea de tiempo', 'Crear, editar y borrar fechas y rangos', [
    'add_date',
    'add_range',
    'edit_date',
    'edit_range',
    'remove_date',
    'remove_range',
  ]),
  covered(
    'story-book',
    'Línea de tiempo',
    'Vincular y desvincular capítulos, temas y párrafos a fechas y rangos',
    ['link_date', 'link_range', 'unlink_date', 'unlink_range'],
  ),
  covered(
    'story-book',
    'Personajes y escenarios',
    'Crear y vincular personajes y escenarios de la historia, y actualizar su narrativa',
    ['create_resource', 'set_resource_narrative'],
  ),
  covered('story-book', 'Portada', 'Generar la portada', ['PORTADA']),
  covered('story-book', 'Ingredientes', 'Vincular y desvincular proyectos como ingredientes', [
    'INGREDIENTE',
  ]),
  covered('story-book', 'Versiones', 'Guardar y listar versiones del proyecto', ['VERSION']),
  covered('story-book', 'Estructura', 'Mover y reordenar capítulos, temas y párrafos (arrastrar)', [
    'move_element',
  ]),
  covered(
    'story-book',
    'Formato',
    'Negrita, cursiva, subrayado, tachado, color y resaltado de un fragmento',
    ['format_text'],
  ),
  covered('story-book', 'Vocabulario', 'Crear y deshacer términos del autor con su definición', [
    'tag_term',
    'untag_term',
  ]),
  covered('story-book', 'Protección', 'Proteger y liberar fragmentos de texto', [
    'protect_text',
    'unprotect_text',
  ]),
  covered('story-book', 'Portada', 'Elegir la portada que se muestra y eliminar portadas del historial', [
    'PORTADA',
  ]),
  covered('story-book', 'Ingredientes', 'Activar y desactivar un ingrediente y elegir su versión', [
    'INGREDIENTE',
  ]),
  {
    kind: 'story-book',
    area: 'Portada',
    capability: 'Subir una imagen como portada',
    status: 'excluded',
    note: 'el archivo lo aporta la persona; el asistente genera portadas (PORTADA)',
  },
  // Guión
  covered('screenplay', 'Texto', 'Escribir acción, diálogos, acotaciones y transiciones', ['replace_text']),
  covered(
    'screenplay',
    'Escenas',
    'Crear una escena y cambiar su INT/EXT, lugar, momento y escenario vinculado',
    ['insert_scene', 'set_scene'],
  ),
  covered('screenplay', 'Planos', 'Crear un plano y cambiar su encuadre, segundos y cámara', [
    'insert_shot',
    'set_shot',
  ]),
  covered('screenplay', 'Diálogos', 'Añadir diálogos y presencias silenciosas de personajes', [
    'insert_dialogue',
  ]),
  covered('screenplay', 'Estructura', 'Eliminar escenas, planos, personajes y diálogos', ['remove_element']),
  covered('screenplay', 'Personajes y escenarios', 'Crear y vincular personajes y escenarios', [
    'create_resource',
    'set_resource_narrative',
  ]),
  covered(
    'screenplay',
    'Estructura',
    'Mover y reordenar escenas y planos (un plano se lleva su acción y diálogos)',
    ['move_scene', 'move_shot'],
  ),
  covered('screenplay', 'Formato', 'Formato, términos del autor y texto protegido en los bloques', [
    'format_text',
    'tag_term',
    'untag_term',
    'protect_text',
    'unprotect_text',
  ]),
  covered('screenplay', 'Versiones', 'Recuperar una versión anterior como borrador', ['VERSION']),
  {
    kind: 'screenplay',
    area: 'Producción',
    capability: 'Tablero de producción de planos de un guión',
    status: 'excluded',
    note: 'es el tablero de las categorías de video que aún no se pueden crear; la producción de los planos del guión se hace en el largometraje (PELICULA)',
  },
  // Escenario
  covered('stage', 'Ficha', 'Escribir la descripción y los campos del escenario', ['set_field']),
  covered('stage', 'Imágenes', 'Generar y regenerar el panorama 360° y los cuatro ángulos', ['ESCENARIO']),
  covered('stage', 'Imágenes', 'Ver las imágenes, las referencias y la papelera con sus rutas', [
    'ESCENARIO',
  ]),
  covered('stage', 'Imágenes', 'Reemplazar una imagen por otra de la papelera', ['ESCENARIO']),
  covered('stage', 'Imágenes', 'Eliminar imágenes de la papelera para siempre (la persona confirma)', [
    'ESCENARIO',
  ]),
  covered('stage', 'Referencias', 'Añadir y quitar las referencias de creación', ['ESCENARIO']),
  {
    kind: 'stage',
    area: 'Imágenes',
    capability: 'Subir una fotografía o importarla por URL',
    status: 'excluded',
    note: 'el archivo o la dirección los aporta la persona; el asistente genera las imágenes (ESCENARIO)',
  },
  // Largometraje
  covered('film', 'Parámetros', 'Cambiar proporción, megapíxeles y pasos', ['set_field']),
  covered('film', 'Escenas', 'Cambiar la duración de un plano y escribir su prompt a mano', [
    'set_scene_frames',
    'set_scene_prompt',
  ]),
  covered('film', 'Escenas', 'Descartar un clip que ya no está en el guión', ['remove_scene']),
  covered(
    'film',
    'Continuidad',
    'Elegir cómo un clip sigue al anterior (automática, misma toma, corte, fotograma inicial, escena nueva), escribir su nota y usar el último fotograma como referencia',
    ['set_scene_continuity'],
  ),
  covered(
    'film',
    'Continuidad',
    'Escribir la nota de continuidad con el modelo y generar el fotograma inicial de un plano',
    ['PELICULA'],
  ),
  covered('film', 'Parámetros', 'Cambiar la resolución final del escalado (megapíxeles finales)', [
    'set_field',
  ]),
  covered('film', 'Escenas', 'Trabajar escena por escena: previsualizar los clips de una escena del guión', [
    'PELICULA',
  ]),
  covered(
    'film',
    'Producción',
    'Generar los videos finales escalados con LUp de una escena (clips aprobados)',
    ['PELICULA'],
  ),
  covered('film', 'Origen', 'Ver los planos, generar la película desde el guión y actualizarla', [
    'PELICULA',
  ]),
  covered(
    'film',
    'Prompts',
    'Hacer que el modelo escriba o regenere el prompt de un plano (confirmando si era manual)',
    ['PELICULA'],
  ),
  covered('film', 'Producción', 'Aprobar, retirar la aprobación, rehacer, detener y reintentar', [
    'PELICULA',
  ]),
  // Personaje
  covered(
    'character',
    'Ficha y fotos',
    'Interpretar, generar y gestionar la ficha, las fotos, los outfits y las papeleras',
    ['PERSONAJE'],
  ),
  // Cualquier proyecto
  covered('project', 'Proyectos', 'Crear un proyecto', ['CREAR_PROYECTO']),
  covered('project', 'Proyectos', 'Leer el contenido de otro proyecto', ['LEER_PROYECTO']),
  covered('project', 'Calidad', 'Revisar la continuidad', ['CONTINUIDAD']),
  covered('project', 'Proyectos', 'Renombrar un proyecto (también el abierto, por su campo de título)', [
    'PROYECTO',
  ]),
  covered('project', 'Proyectos', 'Enviar a la papelera (la persona confirma), restaurar y ver la papelera', [
    'PROYECTO',
  ]),
  covered('project', 'Proyectos', 'Exportar el proyecto abierto (PDF, Word, Markdown, ficha o imagen)', [
    'PROYECTO',
  ]),
  {
    kind: 'project',
    area: 'Proyectos',
    capability: 'Abrir un proyecto',
    status: 'excluded',
    note: 'cambiaría la vista en mitad de una respuesta y el asistente trabaja sobre el proyecto abierto; la persona decide cuándo navegar',
  },
  {
    kind: 'project',
    area: 'Proyectos',
    capability: 'Eliminar para siempre',
    status: 'excluded',
    note: 'la persona escribe su frase de confirmación en Inicio; es irreversible',
  },
  {
    kind: 'project',
    area: 'Modelos',
    capability: 'Elegir el modelo y el modo de la barra superior',
    status: 'excluded',
    note: 'lo decide la persona: toda función de IA usa el modelo que ella eligió',
  },
]);

/** The operation or command names a register names, by kind. */
export const parityVia = (rows = ASSISTANT_PARITY) => [...new Set(rows.flatMap((row) => row.via || []))];

/** The generated document: what the register says, as the page published with the development documents. */
export function assistantParityMarkdown(rows = ASSISTANT_PARITY) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  const lines = [
    '# Paridad del asistente',
    '',
    '<!-- Generado por tests/assistant-parity.test.cjs desde public/js/contracts/assistant-parity.js. No se edita a mano. -->',
    '',
    'Regla: el asistente general debe poder hacer lo que una persona puede hacer a mano en cualquier proyecto. Esta tabla',
    'lista, por tipo de proyecto, lo que una persona puede hacer y cómo lo hace el asistente. Una fila está cubierta solo',
    'cuando nombra la operación o el comando que lo hace; una fila que falta dice en qué lote se hará. Las filas salen de',
    'los contratos de cada documento y de los módulos de cada workspace, y se confirman en la interfaz al implementarlas.',
    '',
    `Cubiertas: ${count('covered')} · Faltan: ${count('missing')} · Excluidas: ${count('excluded')}.`,
    '',
  ];
  for (const [kind, name] of Object.entries(PARITY_KINDS)) {
    const own = rows.filter((row) => row.kind === kind);
    if (!own.length) continue;
    lines.push(
      `## ${name}`,
      '',
      '| Área | Lo que se puede hacer a mano | Estado | Cómo lo hace el asistente o plan |',
      '| --- | --- | --- | --- |',
    );
    for (const row of own) {
      const how =
        row.status === 'covered'
          ? row.via.map((item) => `\`${item}\``).join(', ')
          : row.status === 'missing'
            ? `Lote ${row.batch}${row.note ? ` · ${row.note}` : ''}`
            : row.note;
      lines.push(`| ${row.area} | ${row.capability} | ${PARITY_STATUS[row.status]} | ${how} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Lotes',
    '',
    '1. Línea de tiempo del Story Book (hecho).',
    '2. Mover y reordenar en libro y guión, y gestión de proyectos: renombrar, papelera y restaurar (hecho). El tipo del escenario y la categoría de un proyecto no se cambian a mano, así que no figuran.',
    '3. Formato, términos y protección del texto en libro y guión; portadas, ingredientes y versiones; imágenes y referencias de escenarios (hecho).',
    '4. Largometraje: duración y prompt de cada plano, generación, previsualizaciones, aprobación y control del trabajo (hecho). Las previsualizaciones necesitan el modelo de video local que elige la persona en la barra superior.',
    '',
  );
  return lines.join('\n');
}
