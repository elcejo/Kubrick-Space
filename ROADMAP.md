# Presentación y seguimiento del roadmap


## Versión previa a cada edición con IA y más herramientas del asistente (CK-AI-029) — 2 de noviembre de 2026

Nuevo: antes de cada trabajo de IA el servidor guarda una versión del proyecto sin modificar; el asistente guarda versiones con nota, vincula y desvincula ingredientes, genera la portada, revisa la continuidad (solo lectura) y completa escenarios en lote. Pendiente de verificar con modelos reales; restaurar una versión sigue siendo desde el historial de Versiones.

## El asistente completa escenarios y crea variantes de personajes — 2 de noviembre de 2026

Nuevo: comando ESCENARIO (esquema 1) para completar la fotografía de cualquier escenario, cambiarlo o rehacer imágenes sin abrirlo; el asistente recibe la foto principal de cada personaje y el estado de cada escenario, y crea variantes (mismo personaje con otra edad) con CREAR_PROYECTO y PERSONAJE con attachmentImage. Pendiente de verificar con modelos reales.

## Largometraje por escenas y video final con LUp — 3 de noviembre de 2026

Continuidad entre clips: modos automático, continuación, corte, fotograma inicial y escena nueva; aspecto de cada escena y nota de continuidad escritos por el modelo (con el último fotograma del clip anterior si el modelo ve imágenes); fotograma inicial generado con el modelo de imagen; continuación guiada por los últimos fotogramas del clip anterior con las guías nativas de H3; y filtro opcional de visión en el selector de modelos. Sin verificar en vivo con la GPU: las guías (`KubrickH3Tail`, `MiniMaxH3AddGuide`) y el fotograma inicial dependen de reiniciar el motor local para cargar el nodo nuevo.

Un plano es un clip y dura lo que el plano dice: se acabó la división en partes. El prompt de cada clip se compone de tres partes: referencias y línea técnica (plano, lente, apertura, duración) programáticas, y la descripción creativa del modelo. El panel de tareas actualiza la barra, el paso y el reloj cada segundo y el video de previsualización ya no parpadea.

Panel de tareas: los videos locales se miden por etapas (barra de colores y leyenda como en Skalibur), muestran el paso en curso con su tiempo y una previsualización en vivo con TAEH3 mientras el modelo muestrea. El modelo TAEH3 vive ahora en `models/video/h3/preview`. Requiere reiniciar el motor local para cargar el nodo nuevo; sin verificar en vivo con la GPU hasta entonces.

El tablero muestra una escena del guión a la vez, con flechas a la anterior y la siguiente; cada clip es una fila de tres nodos (previsualización, prompt y parámetros, video final). Las previsualizaciones y los videos finales se generan solo para la escena abierta. El video final repite la pasada base aprobada y la escala con H3 LUp (optimizador sin atención dispersa) a la resolución final elegida; película versión 5. Los clips antiguos que quedaron fuera del guión se descartan uno a uno o todos a la vez. El encabezado pasa a «Control de escena» con selectores propios (relación de aspecto con las 25 proporciones de Skalibur, resolución de previsualización y final) y encima hay un nodo con la escena completa, en previsualización o en resolución final cuando todos sus clips están listos. Sin verificar en vivo: la generación del video final con el motor local (la gráfica y los contratos están probados con un motor simulado). Pendiente: editar a mano las referencias de cada clip, la semilla y una vista general del metraje.

## Largometraje más profesional: planos largos, referencias y fallos — 3 de noviembre de 2026

Corregido: un plano con más diálogo del que cabe en un clip ya no detiene la película; se divide solo en partes consecutivas sin recortar texto. Los personajes vinculados desde un borrador (el caso habitual) ahora cuentan como referencia; antes solo se reconocían los de una versión guardada, y por eso solo aparecía el escenario. Nuevo: avisos por clip sobre sus referencias (sin foto, no vinculado, citado sin referencia), lista de fallos en el tablero con «Reintentar los fallidos», clips «Parte 2/3», «Descartar este clip» para los que salieron del guión, y esquema de película versión 4. El agente suma `remove_scene` y el asistente `PELICULA retry_failed`. Pendiente: editar a mano las referencias de cada clip, la semilla y una vista general del metraje (ver el plan en la respuesta de esta sesión).

## Paridad de edición, lote 4: largometraje y exportar — 3 de noviembre de 2026

Nuevo: el agente escribe el prompt de un plano y cambia su duración (`set_scene_prompt`, `set_scene_frames`); el comando `PELICULA` lista los planos, genera la película, hace que el modelo escriba un prompt, previsualiza, aprueba, retira la aprobación, rehace, detiene y reintenta; `PROYECTO` exporta el proyecto abierto. Los trabajos aparecen como tarjeta en el chat. El tablero de producción de planos del guión no es una función del guión (es del tablero de las categorías de video no creables) y sale del registro como excluida, igual que abrir un proyecto. El registro queda sin filas pendientes: 42 cubiertas y 6 excluidas con su motivo. Pendiente de verificar con modelos reales, y de ampliar el registro con lo que una auditoría futura encuentre.

## Paridad de edición, lote 3: formato, portadas, ingredientes, versiones e imágenes — 3 de noviembre de 2026

Nuevo: el agente da formato a fragmentos, crea términos con definición y protege texto (libro y guión, 5 operaciones con esquema); el asistente elige y elimina portadas, activa o desactiva ingredientes y fija su versión, recupera una versión de un guión abierto y gestiona las imágenes de un escenario (ver, traer de la papelera, referencias, vaciar la papelera). Las acciones irreversibles piden confirmación a la persona. Se retira del registro «restaurar versión» del libro porque a mano solo existe en guiones. Quedan el lote 4 (largometraje y producción de planos) y las filas excluidas, que necesitan un archivo o una dirección de la persona.

## Paridad de edición, lote 2: mover y gestionar proyectos — 3 de noviembre de 2026

Nuevo: el asistente mueve capítulos, temas y párrafos del Story Book (`move_element`), escenas y planos del guión (`move_scene`, `move_shot`) y gestiona proyectos con el comando `PROYECTO`: renombrar, enviar a la papelera con confirmación, restaurar y ver la papelera. Se retiran del registro el cambio de categoría de proyecto y de tipo de escenario, porque a mano no se pueden cambiar (el tipo del escenario es de solo lectura). Pendientes: lotes 3 (formato, etiquetas, bloqueos, portadas, ingredientes, versiones, imágenes de escenarios) y 4 (largometraje y producción de planos).

## Paridad de edición del asistente y línea de tiempo — 3 de noviembre de 2026

Nuevo: registro de paridad (`assistant-parity.js`, tabla `ASSISTANT-PARITY.md`) con lo que una persona puede hacer a mano en cada tipo de proyecto y cómo lo hace el asistente, y primer lote: el agente de edición del Story Book crea, edita, vincula y borra fechas y rangos de la línea de tiempo (10 operaciones con esquema). Siguientes lotes: 2 mover y reordenar, y nombre, categoría, eliminar y restaurar proyectos; 3 formato, etiquetas, bloqueos, portadas, ingredientes, versiones e imágenes de escenarios; 4 largometraje y producción de planos. Las filas del registro se confirman en la interfaz al implementarlas.

## Continuidad por partes y pensamiento simulado para modelos locales — 3 de noviembre de 2026

Nuevo: con un modelo local, la revisión de continuidad es un trabajo del servidor que lee todo el material por partes con un cuaderno de hechos (CK-AI-033), con avance «parte i de N» y tarjeta en el chat; y el chat ofrece pensamiento simulado (CK-AI-034) con selector Sin pensamiento / Bajo 5 / Medio 10 / Alto 20 / Personalizado, solo para modelos locales. Los esquemas `continuity-review` y `thinking-step` están publicados. Pendiente de verificar con un modelo local real: la calidad de los hallazgos, los tiempos de una lectura larga y si el nivel Bajo es el predeterminado adecuado.

## Revisión de continuidad sin recortes — 3 de noviembre de 2026

Corregido: la revisión de continuidad del chat fallaba con «texto inválido o demasiado largo (máximo 100000)». Ahora envía todo el proyecto y todos sus ingredientes sin recortar y el servidor acepta mensajes de hasta 2.000.000 de caracteres. La lectura por partes para modelos locales de contexto pequeño está en la entrada siguiente.

## Chat profesional: barra medida, tarjetas de resultado y lectura sin saltos — 3 de noviembre de 2026

Nuevo: la barra de progreso de las tareas muestra datos medidos (palabras frente al objetivo, ronda x de ~total, piezas) o una barra en movimiento sin número; las tareas de personaje y escenario y las portadas aparecen en el chat como tarjetas de color con la imagen del proyecto de fondo, avance, detener y abrir, y se conservan en la conversación. Corregido: el editor ya no vuelve arriba en cada cambio del agente. Pendiente de verificar con modelos reales; siguiente: pensamiento simulado para modelos locales (propuesto, sin implementar).

## Ronda x de total y continuidad en cada ronda — 3 de noviembre de 2026

Nuevo: el agente de edición muestra «ronda x de ~total» y en cada ronda revisa continuidad (cronología, personajes, lugares, hechos) con `continuity` en el esquema de ronda; no completa con revisión ausente ni contradicciones abiertas. Pendiente de verificar con modelos reales; ideas siguientes: avisar tras N rondas sin cambios nuevos y revisión determinista complementaria de IDs de personajes en guiones.

## Modelo del workspace obligatorio y rondas largas del agente — 2 de noviembre de 2026

Corregido: una ronda del agente con más de 8 operaciones fallaba entera («admite hasta 8 elementos y tiene 12») y ahora aplica las 8 primeras y continúa. Toda función de IA dentro de un proyecto exige el modelo elegido en la barra superior; el modelo de configuración ya no cuenta y el asistente no envía sin él.

## Todo dato de un modelo pasa por un esquema (CK-SCHEMA-002) — 2 de noviembre de 2026

Nuevo: las herramientas de personaje (gestión, consultas, inventario, dirección de piezas, retrato, revisión, maquillaje y lore), el sobre de cada ronda del agente y los comandos del asistente general se comprueban contra su esquema; un desvío vuelve al modelo una vez con la ruta exacta. Se retiraron los comandos ESCRIBIR_LIBRO y EDITAR_DOCUMENTO (HTML completo), la ruta /api/jobs/book y el agente heredado de HTML; CREAR_PROYECTO ya no escribe contenido: crea el proyecto vacío y tipado. Un tipo de proyecto nuevo no puede añadirse sin su esquema (prueba de cobertura). Sin pendientes de esquema.

## Un esquema cerrado por tipo de proyecto (CK-SCHEMA-001) — 2 de noviembre de 2026

Nuevo: Story Book, escenario y metraje cambian solo mediante operaciones con su JSON Schema publicado, igual que el guión; los campos que el formato no tiene se descartan y se avisa, y lo demás se valida con la ruta exacta del error. En personaje, la propuesta de la ficha se valida contra el esquema que recibió el proveedor y, ante cualquier desvío o razón de la ficha, se devuelve al modelo una vez con su motivo antes de mostrar un error al autor. Regla fija: todo cambio en un tipo de proyecto mantiene su esquema compatible. Pendiente: herramientas de gestión de personajes, inventario de piezas y lore.

## Esquema cerrado de operaciones del guión (CK-SCRIPT-021) — 2 de noviembre de 2026

Nuevo: la IA solo puede cambiar un guión mediante nueve operaciones con un JSON Schema publicado (docs/development/schemas); lo que no cabe en él no se aplica y vuelve al modelo con la ruta exacta del error. Se valida cada ronda de la adaptación y cada operación del agente de edición, y se pide al proveedor que escriba dentro del esquema cuando el modelo lo admite (con respaldo a JSON simple). Una implementación independiente de JSON Schema coincide con la nuestra en las pruebas. Pendiente: Story Book, escenario, metraje y personaje, y cerrar el camino heredado de HTML del Story Book.

## Guiones anteriores al formato actual (CK-SCRIPT-020) — 2 de noviembre de 2026

Cambio: todo plano lleva su acción y su transición (vacías si no hay texto). Al abrir un guión anterior se completan sin tocar lo escrito, y un guión existente se actualizó (planos con transición; copia previa guardada). La transición ya era parte del formato; los guiones antiguos simplemente no la tenían.

## Lectura mientras edita, personajes vinculados, presencia silenciosa y revisión al vincular — 2 de noviembre de 2026

Nuevo: (1) durante una edición del asistente se puede desplazar el documento para leerlo (CK-ED-001); (2) los personajes y lugares que el asistente escribe por nombre quedan vinculados a su ingrediente en el servidor, también en el guión (CK-SCRIPT-019); (3) un personaje que aparece sin hablar se registra como presencia silenciosa —acotación y diálogo vacío—, que lo vincula al plano y lo hace referencia del largometraje; (4) al vincular un proyecto como ingrediente se ofrece incorporar los ingredientes que él tiene y el receptor no (CK-ING-032), con todos marcados y la posibilidad de elegir. Verificado con pruebas, en la app con un libro de cuatro ingredientes y con una orden de confirmación real; la presencia silenciosa aún no se ha probado produciendo un plano del largometraje.

## Fallo de «la escena necesita al menos un plano» (CK-SCRIPT-018) — 2 de noviembre de 2026

Corregido: la generación del guión fallaba al azar (2 de cada 6 pruebas reales) con «La escena necesita al menos un plano». Era un mensaje engañoso: el código rechazaba también las escenas con más de 6 planos y los lotes de más de 8 operaciones o 24 000 caracteres, y el modelo, sin saber qué corregir, repetía el error. Ahora una escena admite 1 a 24 planos, el prompt del sistema dice que toda escena necesita al menos un plano, cada escena propuesta se revisa antes de aplicarla con un mensaje preciso y el adaptador usa lotes mayores. Seis generaciones reales seguidas terminaron bien.

## Adaptación por capítulos para guiones muy largos (CK-SCRIPT-018) — 2 de noviembre de 2026

E1 (servidor), E2 (plan visible en el chat y botón «Deshacer adaptación») y E3 (actualización por diferencias con huella por escena y edición por ventanas de guiones largos) implementadas y probadas con proveedor simulado, incluido un libro de 60 000 palabras con contexto por ronda constante; E4 (evaluación con modelo real y prueba de escala de 12 000 palabras) hecha; falta juzgar la calidad dramática con un libro largo y original y con modelos más potentes. Trabajo durable que planifica el libro en unidades de unas 2 500 palabras y adapta cada una con memoria de continuidad, guardando un punto de control por ronda, con progreso real, cancelación, reanudación y deshacer; después, actualización por diferencias y edición por ventanas. Etapas E1 servidor, E2 interfaz, E3 actualizaciones, E4 calidad con modelos reales. Detalle y decisiones abiertas en la especificación.

## Generar el guión se pide al asistente (CK-SCRIPT-015) — 2 de noviembre de 2026

Cambio: se retiró «Generar a partir del contexto» del menú del guión y su función de modelo. Generar o adaptar el guión desde el libro vinculado es ahora una orden al asistente general, que la reconoce, inicia la edición del proyecto abierto y adapta el libro por tramos con las reglas de formato del guión (planos de 5,5 a 9 s, nueve encuadres exactos, acotación por intervención). Motivo: la respuesta única con Haiku 5.5 tardó más de cinco minutos y terminó en 502 por razonamiento «max» sobre 128 000 tokens, y no sirve para guiones largos. «Actualizar esta escena con IA» exige elegir modelo antes de enviar. Límite real: el agente aún envía el libro y el guión completos en cada ronda, así que un guión de horas no cabe; la solución diseñada está en la adaptación por capítulos (CK-SCRIPT-018). Pendiente: probar con un modelo real un libro de varios capítulos.

## Papelera de proyectos por lotes (CK-HOME-001) — 1 de noviembre de 2026

Nuevo: la papelera tiene casillas, «Seleccionar todos» y acciones por lote (restaurar o eliminar definitivamente con una sola confirmación). Se rediseñaron la lista y los botones del diálogo, que carecían de relleno. Verificado en navegador con proyectos desechables; la papelera real no se tocó.

## Más grupos de ropa y props (CK-CHAR-106) — 1 de noviembre de 2026

Añadidos a la biblioteca visual: Brasieres, Baby dolls, Túnicas, Batas, Capas, Turbantes y Leggings (Ropa); Cámaras, Libretas, Libros, Lápices, Varitas, Juguetes, Pelotas, Cangureras, Raquetas, Bates, Pancartas, Linternas, Toallas y Mascotas (Props). Lo que ya existía (bikini, bóxer, anillo, diadema, pants) se dejó igual. Las piezas de los personajes guardados se reagrupan al leerlas, sin reescribir sus datos. Pendiente: comprobar en un personaje real que la extracción de cada grupo nuevo produce una imagen aislada correcta.

## Reanudación de la edición agéntica (CK-AI-028) — 1 de noviembre de 2026

Corregido (hallado en una edición real): al reanudar tras elegir modelo o reiniciar, el trabajo trataba como ajeno al personaje que él mismo había creado, pedía otro nombre al modelo y la propuesta nueva reutilizaba el resultado guardado de otro recurso, de modo que la descripción de un lugar terminó en la ficha de un personaje, otro personaje quedó sin foto y los props de un tercero no se generaron. Ahora los recursos propios no cuentan como ajenos, el resultado guardado se identifica por tipo y nombre, elegir el modelo de imagen ya no pasa el texto del personaje a Local, y los props se reintentan una vez si el modelo falla.

## Local como proveedor de modelos y modos por función — 1 de noviembre de 2026

Se retiró el selector API/Local: LLM, imagen y video listan Local como un proveedor más, siempre primero. El proyecto guarda ahora un modo para texto (mode) y otro para imágenes (imageMode), de modo que un LLM de OpenRouter convive con FLUX Klein local y al revés. El video del largometraje depende solo de su modelo local. Sin pendientes de arquitectura; el flujo de recursos del asistente conserva su decisión por personaje.

## 1 de noviembre de 2026 — Ciclo editorial y recursos (CK-AI-023)

- Implementado: edición del proyecto abierto por elementos con contexto completo
  actualizado en cada ronda; guión conserva escenas, planos, voces y acotaciones.
- Implementado: progreso estimado, indicaciones durante el ciclo, Stop, bloqueo de
  edición manual, validación por lote, CAS y recuperación de checkpoints.
- Implementado: personajes complementarios con descripción, narrativa e imagen;
  elección explícita de Local/API y modelo antes de generar; vínculo al proyecto y
  sincronización de la narrativa tras cambios respaldados por la historia.
- Verificación: pruebas incrementales de 60000 palabras con proveedor simulado,
  flujos HTTP, formatos, conflictos, cancelación y selección pendiente de modelo.
- Limitación real: el manuscrito completo debe caber en el contexto del modelo. La
  longitud mecánica comprobada no garantiza calidad literaria de una obra larga.


## Muse Image y recarga de modelos API — 1 de noviembre de 2026

Identificada una discrepancia de OpenRouter: Images devolvía Muse sin parámetros
y sin endpoints, aunque el endpoint general mostraba Meta activo. El catálogo
comprueba ese proveedor para conservar la compatibilidad conocida de Muse, sin
atribuir capacidades a modelos desconocidos ni inventar precios por imagen.
Añadida recarga compacta junto a los filtros de LLM/imagen: fuerza consulta de
catálogo y ranking, conserva filtros/selección y permite elegir entradas nuevas.
Verificado con datos reales de catálogo, pruebas de caché y navegador aislado.
No se efectuaron generaciones de pago para esta comprobación.

## Qwen 3.8 27B y Gemma 4 E4B — 31 de octubre de 2026

Corregidos nombre y ruta del 27B con alias para selecciones antiguas. Añadido Gemma
tras confirmar descarga completa, hash y formato INT8 ConvRot. Registro de modelos
compartido y protocolo nativo Gemma separado de Qwen, conservando validación de
herramientas. Verificados carga, texto, visión y ciclo herramienta/resultado con
pesos reales; navegador comprueba cuatro opciones, recarga y aislamiento por
proyecto. Pendiente: evaluación de calidad en tareas creativas largas con estos
modelos; la prueba corta no sustituye esa auditoría.

## Qwen 27B local — 31 de octubre de 2026

Añadido el tercer perfil local desde los pesos ya instalados. Catálogo y selector
superior distinguen 4B/9B/27B; la preferencia se conserva por proyecto, sin alterar
los existentes. Mantiene texto, visión, herramientas, cola y carga/descarga.
Validadas rutas conocidas y rechazo de modelos desconocidos. Prueba real en el
motor: carga, texto, herramienta válida con una reparación y visión sintética.
Documentados hash, metadata del archivo y tiempos medidos con offload GPU/CPU.

## Instrucciones en inglés y Diseño limpio — 31 de octubre de 2026

La traza mostró que el desglose de Carlos fallaba porque la ficha ya decía "barba" y el modelo no la listó, y porque leyó el cabello rizado como calvo. Ahora el desglose se completa desde la ficha. Los prompts del ayudante pasan a inglés y el nodo Diseño solo muestra edad, estatura y las piezas. Quedan en español los textos de escritura de libros y el prompt de gestión de personajes, que no intervienen en la creación desde fotografía.

## Auditoría del ayudante de personaje con modelos locales — 31 de octubre de 2026

Se recreó el flujo completo con tres fotografías (mujer, hombre y perro) y los modelos locales. Causas halladas y corregidas: etiquetas de cierre repetidas en las llamadas del 4B, correcciones insuficientes, validación demasiado estricta de la ficha y del desglose, tiempo de arranque del motor contado como espera del modelo, un panel de lore inútil en Local y un error propio: el sondeo de la traza agotaba el límite de generaciones (429). Pendiente real: la composición de Outfit eligiendo variantes con modelo local no se auditó a fondo, el pelaje y el cabello sobre maniquí varían entre generaciones y no hay prueba automática con el motor real.

## Piezas aisladas y campos sin duplicar en Local — 31 de octubre de 2026

Diagnóstico con experimentos directos sobre FLUX: la causa de que las prendas salieran como el personaje completo no era el LLM de 4B ni las referencias, sino el paso que reescribía en Local cada prompt de pieza (describía la imagen entera). Corregido junto con la resolución de las referencias (cabello), los prompts con maniquí en ropa y props, los campos duplicados de Diseño y el vínculo de cada pieza con sus campos. El cabello sobre maniquí sigue variando entre generaciones; se regenera por pieza.

## Creación de personajes desde fotografía con modelos locales — 31 de octubre de 2026

Reproducido de principio a fin con Qwen 3.5 4B y FLUX 3 Klein. Causas corregidas: el motor frío tardaba más de los 45 s de espera; el reintento del desglose enviaba la imagen en un turno anterior y el modelo local lo rechazaba; la validación estricta descartaba inventarios correctos por claves de campo inventadas o piezas omitidas; y la búsqueda de lore, inexistente en Local, hacía fallar el trabajo al final, tras generar todas las piezas. Pendiente real: la extracción de 10 piezas es secuencial (~55 s cada una) y el retrato de props sigue sin barra de progreso por pieza en la tarjeta.

## Líneas de personajes y escenarios en el guión — 31 de octubre de 2026

Dos líneas a los lados del editor reutilizan los puertos y cables de la línea de
tiempo de Story Book: personajes a la izquierda (recorte de rostro) conectan con
los diálogos y escenarios a la derecha con los planos, que heredan el de su escena.
Solo muestran ingredientes vinculados y los selectores siguen siendo la fuente de
verdad, sin cambiar el formato guardado. Pendiente real: acceso por teclado a los
puertos (hoy se usan los selectores) y varias escenas con escenario distinto por plano.

## Inserción intermedia y controles discretos del guión — 31 de octubre de 2026

Las X solo aparecen al recorrer su marco o descendientes, conservando foco de
teclado accesible. Un overlay con el mismo SVG de fusión y estilos de Story Book
permite insertar escenas, planos e intervenciones entre dos elementos contiguos
del mismo nivel. Revalida el destino vivo, comparte creación con los botones
existentes y conserva IDs/contenido/selección. La numeración se recalcula por
posición: insertar entre 1 y 2 produce 1, 2 nueva, 3 anterior; persiste al recargar.
No añade controles al JSON/IA/exportaciones. Verificación de ambos temas,
hover/scroll, geometría con zoom, inserciones de los tres niveles y guardado.

## Eliminación de escenas, planos y diálogos — 31 de octubre de 2026

X circular negra/roja en la esquina superior derecha de cada marco. Mantiene una
escena por guión y un plano por escena como mínimo, con recuentos vivos y controles
que aparecen/desaparecen al añadir o eliminar. Diálogos opcionales: retirar toda la
intervención sin tocar acción/transición u otras intervenciones; permite añadirlos
nuevamente. La migración respeta planos modernos sin diálogo para evitar que se
recreen tras recargar. Pruebas de clicks repetidos, persistencia, serialización,
selectores y geometría circular en ambos temas; no modifica versiones históricas.

## Cajas completas de plano e intervención — 31 de octubre de 2026

El borde continuo del plano engloba encabezado, acción, diálogos y transición.
Cada intervención reúne personaje/voz, acotación y texto dentro de una caja dotted
magenta. Se conserva la caja dotted de escena y los botones de cada nivel.
Agrupación visual por IDs, sin recrear campos ni disparar renders repetidos;
conserva foco/selección y no introduce contenedores en JSON, IA o exportaciones.
Verificado con inserciones, guardado/recarga, colapso y ambos temas en navegador.

## Acciones rotuladas y acotaciones de guiones anteriores — 31 de octubre de 2026

Añadir diálogo es ancho, centrado y con borde magenta como el campo de personaje.
Los siguientes niveles dicen Añadir plano y Añadir escena; este último permanece
al final del manuscrito fuera de las cajas y comparte operación con el índice.
La migración completa los diálogos antiguos con una acotación vacía vinculada al
hablante, sin inventar indicaciones de actuación ni reescribir contenido o versiones.
Guarda identidades y es idempotente. Se comprueban inserciones repetidas, exclusión
de controles del JSON y posición/anchura/color en navegador.

## Edición sin resplandor y varios personajes por plano — 31 de octubre de 2026

Los campos del guión eliminan el resplandor azul al editar. Placeholders itálicos
sobre una capa absoluta, con cursor al inicio al hacer clic en un campo vacío,
sin convertirse en texto ni alterar la selección normal. Cada plano tiene un +
compacto para añadir personaje/voz, acotación y diálogo propios antes de la
transición. Se conservan escena, plano, IDs e intervenciones anteriores; la UI de
inserción se excluye de persistencia, IA y exportación. Verificación con selectores
reales, clic/escritura, guardado/recarga y ambos temas en navegador.

## Controles de plano y campos de diálogo — 31 de octubre de 2026

Numeración Escena/Plano estática por posición; el encuadre vuelve a una lista
propia con las nueve opciones y sus ayudas. Duración con flechas nativas, de 1 a 10 s
en pasos de 0,5; valida sin perder el valor previo. Ángulo/movimiento se conservan.
Diálogo usa borde dotted en edición; acción y diálogo vacíos muestran placeholders
que no se guardan como contenido. Serialización, contexto IA y exportaciones
conservan el texto técnico sin controles. Probado con selectores reales, valores
límite, guardado/recarga y temas claro/oscuro en navegador.

## Formato único de guión nuevo y antiguo — 31 de octubre de 2026

Los guiones anteriores abren con un plano explícito dentro de cada caja de escena,
igual que los nuevos. El marcador recupera el encuadre anterior sin inventar cámara
o tiempos. La preparación es idempotente y conserva texto, IDs, vínculos, procedencia,
versiones guardadas e identidad del plano para largometraje. No fusiona escenas.
La plantilla, Añadir escena y el botón + de plano ofrecen los mismos seis campos;
las plantillas iniciales vacías incompletas se actualizan sin perder sus IDs.
Verificado con ambos formatos en navegador aislado, guardado, recarga y regresiones.

## Separación visual de escenas y añadir plano al pie — 31 de octubre de 2026

Cada escena del guión tiene su caja con borde dotted y un botón «+» de ancho
completo al final. Añade un plano con dirección, acción, personaje/voz, acotación,
diálogo y transición, sin afectar las otras escenas. El índice comparte la misma
operación. Los controles no pasan a JSON, IA, preview ni exportaciones; al colapsar
la escena también se oculta su botón. Verificación de inserción repetida, IDs,
guardado/recarga y visualización en navegador.

## Escenas con varios planos y largometraje por plano — 30 de octubre de 2026

Implementado: guión técnico con planos shot/h6 dentro de cada escena h2; cada plano
conserva ID, dirección de cámara y sus bloques, sin duplicar diálogo. Menú flotante,
índice con saltos/añadir plano, plantilla, Enter, vista previa, contexto y exportación
usan la misma estructura. La adaptación desde ingredientes exige varios planos
por escena y preserva la versión seleccionada y las decisiones compatibles.
Largometraje v3 prepara y renderiza un clip por plano, con identidad escena/plano,
referencias y estados independientes. Lee v1/v2 conservando medios; planos retirados
se retienen marcados. Un plano demasiado largo pide dividirlo y no recorta diálogo.
Verificado mediante contratos, editor, HTTP y motor simulado; navegador real con
adaptación, guardado, recarga y preview sin errores ni llamadas a proveedores reales.
Los guiones antiguos se leen como planos implícitos; una nueva adaptación desglosa
sus escenas sin migraciones destructivas ni cambios en versiones históricas.

## Selectores del guión: Personalizado y voz normal — 30 de octubre de 2026

Corregido: elegir Personaje → Personalizado deja visible el campo en escenas nuevas y al borrar un nombre; el selector de voz permite regresar a Normal desde V.O. u otra extensión. Verificación con los selectores reales, sus menús, observadores del editor, serialización validada y exportación sin controles de UI. Sin cambios de esquema ni migración de proyectos.

## Versión 0.1.1: escaneo de malware y editor de guión — 30 de octubre de 2026

Nuevo: el almacén de claves de API cambia de nombre (ahora apiKeyVault, módulo api-key-vault.cjs) porque algunos escáneres de repositorios confundían el nombre anterior con carteras cripto; no cambia su comportamiento ni sus datos. Las plantillas HTML del historial de tareas dejan de ser líneas de más de 1000 caracteres. Se publican también las mejoras del largometraje (modelo de video local elegido en la barra superior, referencias del guión vinculado) y del editor de guión (tooltips, selectores propios, listas de escenarios y personajes vinculados).

## Editor de guión: ayudas y listas vinculadas — 30 de octubre de 2026

Nuevo: cada control del guión explica con un tooltip qué hace y qué significa cada opción (por ejemplo los 9 tipos de plano). Escenario y Personaje muestran solo los ingredientes vinculados al guión, y el personaje que habla se elige de esa lista.

## Creación de proyectos: solo lo terminado — 30 de octubre de 2026

Nuevo: el asistente de creación bloquea lo que aún no está listo y lo marca «Próximamente». Se pueden crear Libros (Story Book y Guión), Personajes (los tres tipos), Escenarios (interior y exterior) y el Largometraje. Quedan bloqueados Música (single, álbum y soundtrack) y Cortometraje, Documental, Videoclip y Animación. El asistente de IA también deja de poder crear esos tipos con el comando CREAR_PROYECTO: lo rechaza sin pedir autorización y le explica qué puede crear; la lista está en un único contrato compartido con el asistente de creación.

## Publicación de la versión 0.1.0 en GitHub — 30 de octubre de 2026

Nuevo: Kubrick Space 0.1.0 se publica como repositorio nuevo (Kubrick-Space, privado hasta su revisión) con licencia MIT y avisos de terceros. Solo contiene la aplicación, el motor auxiliar y su arranque; no incluye proyectos, claves, generaciones, auditorías ni documentación de desarrollo, y ningún peso de modelo (se descargan según la guía de instalación del README, con las rutas y nombres exactos de archivo). Se añade scripts/install-engine.ps1, que descarga ComfyUI 0.43.0 verificando su huella, crea el entorno de Python e instala los paquetes. Pendiente: confirmar las licencias de MiniMax H3 (la comunidad excluye EE. UU., UE, Reino Unido y Corea) y de FLUX 3 Klein y del LoRA Turbo, reescribir h3_optimization.py desde cero si se quiere que todo el motor propio sea MIT (hoy deriva de KJNodes, GPL-3.0), y hacer público el repositorio tras la revisión.

## Largometraje: flujo de H3 corregido según el de Skalibur — 30 de octubre de 2026

Corregido: la pasada base usaba los sigmas fijos de 3 pasos, que son del escalador de latente. Ahora usa 4 pasos con el planificador `simple` sobre el modelo optimizado, como el H3 Simple Sampler de Skalibur. La atención dispersa queda desactivada por pérdida de calidad. Las referencias se codifican a 1 MP independientes del tamaño del video, con lo que la huella del conditioning ya no depende de la resolución; 1 MP son 1024×1024 píxeles (previsualización de 864×480). Nuevo en el motor: el LUp Sampler de Skalibur portado (KubrickH3LatentUpscaler), probado a 1 MP en 4 pasos. Pendiente: guardar el latente base y ofrecer el escalado de las aprobadas en el tablero; la lógica de tokenización y referencias con nombre se tomó del código de los nodos de origen.

## Fotografías manuales y grupos de ingredientes — 30 de octubre de 2026

Subir está disponible en toda galería de personaje y también en la bienvenida para
usar una primera fotografía sin IA. Las cargas posteriores conservan la principal
y Outfit. Ingredientes organiza todos los tipos en grupos propios, con el botón
de añadir separado; el reverso permite buscar/vincular escenarios, música y metraje
además de personajes y libros, respetando versiones y borradores.
Verificado en navegador aislado: primera carga, segunda carga, recarga, principal
conservada y escenario vinculado con su contenido; cero llamadas de generación.

## Largometraje: conditioning guardado y previsualizaciones con H3 — 30 de octubre de 2026

Nuevo: segunda y tercera etapa del largometraje. Se codifica el conditioning de todas las escenas con una sola carga del text encoder, cada uno se guarda en un archivo, se liberan los modelos y después se genera una previsualización por escena (0,4 MP, 3 pasos, con audio) cargando el conditioning guardado. Cada video tiene aprobar (palomita) y rehacer (recarga); rehacer pasa a una cola con prioridad que se atiende al terminar el video en curso. Las referencias se citan por nombre (`<Marta>`) en lugar de `<Picture 1>`, con la foto principal del personaje. Medido en la RTX 3060: ~45 s por conditioning y, con el nodo H3 Optimization de Skalibur (56 grupos de atención y 4 trozos de feedforward), ~80 s por previsualización frente a ~101 s sin él; el modelo no queda residente entre videos por falta de RAM. Pendiente: comprobar con ojo si la atención dispersa cambia la calidad y valorar instalar SageAttention y Triton en el motor. Pendiente: escalado de las escenas aprobadas, tokenizador de audio de Skalibur, ensamblado del metraje, limpiar conditioning de escenas borradas y compartir el observador de trabajos entre escenarios y película.

## Largometraje: la barra superior decide el video — 30 de octubre de 2026

Nuevo: las previsualizaciones del largometraje solo se generan en modo Local y con el modelo de video elegido en la barra superior (selector «Video», sin selección por defecto); en modo API o sin modelo el servidor lo rechaza y el tablero explica qué falta. Las referencias de cada escena incluyen también los ingredientes vinculados al guión, siempre que tengan foto principal.

## Interpretación fotográfica local de personajes — 30 de octubre de 2026

Corregido un rechazo de Qwen local por una sección de campos inexistente. La
instrucción distingue diseño y narrativa, el adaptador permite una corrección
acotada de esquema y el aviso identifica el motor y el modelo de texto reales.
Pruebas de conservación de referencias, límite de reintentos y cancelación; una
interpretación real local de la fotografía reportada produjo una ficha válida,
sin ejecutar la generación de retrato ni modificar el proyecto del usuario.

## Portadas automáticas de guión — 30 de octubre de 2026

Implementada portada editorial sin IA: PNG 1280×1920 blanco, nombre y SCREENPLAY
negros, marco negro. Se crea con el proyecto, sigue el nombre del borrador y se
muestra en Inicio. Versiones previas conservan su imagen; guiones existentes se
adaptan al consultarlos. Sin controles de generación o carga; el servidor bloquea
portadas IA para guiones. Verificación: raster, creación, renombrado, borradores,
versiones, biblioteca y rechazo de proveedor mediante fixtures aislados.

## Largometraje: escenas como nodos y prompts de H3 — 30 de octubre de 2026

Nuevo: el workspace de Largometraje convierte cada escena del guión vinculado en un nodo de video (aún sin video) con su nodo de parámetros al lado, ordenados en vertical; el prompt de cada escena lo escribe el LLM con plano, diálogos, voces en off, personajes y escenario como referencias numeradas, y ninguna escena supera los 10 segundos. Solo se preparan nodos y prompts: el video no se genera. Pendiente: generación con MiniMax H3 (LoRA de 3 pasos, audio, previsualización a 0,4 MP y escalado de latente, con las funciones del paquete propio del autor); prueba de viabilidad de H3 en una RTX 3060 de 12 GB; extraer el observador de trabajos en segundo plano, hoy copiado entre escenarios y película, a un módulo compartido.

## Revisión de Outfit tolerante con el revisor local — 30 de octubre de 2026

Corregido: un resultado correcto se enviaba a la papelera porque Qwen 4B discrepó en un detalle (el color de las franjas de un gorro conservado). En Local, las discrepancias de detalle en piezas que solo se conservan o se reaplican, y que no son de identidad, ya no bloquean y quedan como aviso en la comprobación. Rostro, piel, cabello, barba, el cambio solicitado y las piezas ausentes siguen rechazando; API conserva toda su exigencia. Si se aprueba, la propuesta reemplaza la principal y la anterior va a la papelera. Pendiente: medir con más casos reales cuántos falsos rechazos quedan.

## Edición local de Outfit y una pieza por grupo — 30 de octubre de 2026

Corregido: al aplicar piezas en Local, el redactor Qwen 4B describía las prendas sin anclar al personaje y FLUX generaba imágenes sin relación con el cambio (prendas sin persona, torso sin cabeza, otra persona). Ahora la instrucción de cada etapa se construye desde las piezas validadas («edita la imagen 1, conserva a la misma persona, aplica la imagen 2…») y se envía lista a FLUX sin reescritura. API conserva su redactor. Comprobado con FLUX real en la GPU con las referencias del autor; falta repetirlo desde la interfaz.

Corregido: la galería Outfit admitía varias piezas seleccionadas en un mismo grupo. Ahora cada grupo tiene una sola pieza viva; elegir otra reemplaza la anterior y, en Ropa y Props, volver a pulsar la activa deja el grupo vacío. Los proyectos guardados con varias conservan la última elección.

Corregido además el HTTP 502 de la comprobación local de Outfit: el modelo escribía un resumen de más de 300 caracteres y el nodo rechazaba toda la revisión por maxLength. Ahora los textos se truncan al normalizar y el esquema local no los limita; la revisión real devolvió 200 en 8–9 s.

## Papelera de escenarios — 30 de octubre de 2026

Las imágenes que una petición reemplaza (panorama o ángulos) y las referencias que se quitan pasan a una papelera del escenario con su ranura, accesible desde el nodo Ángulos. Restaurar intercambia la imagen con la que ocupa su lugar sin perder ninguna; eliminar definitivamente (una o toda la papelera) pide confirmación y borra los archivos que ninguna versión guardada ni otro proyecto usan. Verificado con pruebas de contrato, servidor y jsdom y con un recorrido en navegador contra un proveedor simulado (regenerar, restaurar, eliminar y comprobar que el archivo desaparece). Pendiente: selección múltiple como en Personajes.

## Workspace de escenarios — 30 de octubre de 2026

Implementado el tipo Escenario como workspace propio, con el mismo flujo que Personajes: nodo de elección de vía, asistente y nodos independientes. Descripción y Fotografía están activas (una o varias fotografías, hasta ocho); Opciones e Ingredientes aparecen como «Próximamente». El resultado es una ficha de diseño, una imagen 360° equirrectangular 2:1 que integra las referencias en un único lugar y cuatro ángulos 16:9 del mismo espacio. No hay ropa, props ni rasgos.

La generación es un trabajo duradero del servidor (POST /api/jobs/scenario) con checkpoints: diseño, panorama y cada ángulo se guardan al llegar, un reintento no repite lo pagado y un cambio externo nunca se sobrescribe. Local usa FLUX 3 Klein (2048×1024 y 1360×768); API respeta el modelo del proyecto y pide la horizontal más ancha que ofrezca. El visor 360° es Canvas 2D sin dependencias. Nuevo módulo scenarios sin excepciones de límites ni iconos nuevos; la importación de fotografías por URL admite escenarios.

Verificado con pruebas de contrato, HTTP con proveedor simulado y jsdom. No se comprobó con proveedores reales ni con la GPU: la calidad de la costura 360° y las relaciones 2:1 por modelo de API quedan por medir. Pendiente: habilitar Opciones e Ingredientes, edición manual del diseño y la entrega del escenario al modelo de vídeo.

## Kubrick Space y portabilidad de instalación — 29 de octubre de 2026

Marca actualizada a Kubrick Space en interfaz, código, instrucciones, paquetes,
lanzadores y documentación. El paquete propio de ComfyUI se llama kubrick_space;
la especificación canónica es KUBRICK-SPACE-SPEC.md. Los accesos y cabeceras
heredados se mantienen como adaptadores sin alterar datos persistidos.

Lanzador con resolución dinámica de Node: puntero relativo y recuperación al mover
la carpeta. Raíces de datos y recursos independientes del cwd de la terminal;
activación Python local sin la ruta antigua de la aplicación. Proyectos, modelos,
pesos, claves y versiones conservan su ubicación relativa y contenido.


## Portadas en cola y dirección editorial — 29 de octubre de 2026

Portadas Local/API incorporadas a la cola durable común: concepto, imagen y guardado
con checkpoints, tiempos, cancelación e historial. El navegador observa; el servidor
continúa. Arte capturado sin sobrescribir prosa concurrente. Dirección del lettering
específica de la obra, título dominante y ningún autor predeterminado. El brief llega directamente a Flux sin una segunda reescritura. El contrato de prompt es portable y único para
cliente/servidor. No se modifican las portadas existentes.


## Turbo PDD y resoluciones locales — 29 de octubre de 2026

Integrado el LoRA Turbo instalado mediante un nodo propio que aplica matrices LoRA,
fusiona cabezales PDD y entrega las sigmas de ocho saltos del grid de entrenamiento.
Euler con CFG 1 y fuerza LoRA 1.0; no modificar ComfyUI ni instalar otra extensión.
Portadas y retratos verticales: 1280×1920. Props de Outfit: 1024×1024. Resto del
flujo conserva cola, referencias separadas, cancelación y persistencia de borrador.

## Portada local: validación HTTP y prueba de recorrido — 29 de octubre de 2026

Corregida una validación HTTP heredada que rechazaba provider local antes de llegar
a Flux, aunque el generador directo funcionara. La capa HTTP reutiliza el contrato
de engine persistido y admite backend local, proporciones implementadas y soportes
mannequin exactos. Conserva rechazos de proveedores/modelos/rutas arbitrarios.
La regresión ahora recorre sesión, endpoint público, scope por proyecto, Comfy
simulado, guardado de imagen/borrador y preview de Inicio sin crear una versión.
La validación de una integración requiere distinguir pruebas directas, HTTP,
navegador y GPU; no dar por cubierto un recorrido del editor por probar solo el motor.

## Imágenes locales y vistas previas de borrador — 29 de octubre de 2026

Implementado FLUX 3 Image Klein en ComfyUI 0.43.0 propio: generación y edición con
referencias en todos los flujos de imagen existentes. Perfil instalado en toolbar
Local, FIFO de VRAM compartido con Qwen, cancelación por prompt y temporales
privados. API conserva concurrencia; Local solicita piezas secuencialmente.
Comprobadas generación y edición reales en RTX 3060 sin crédito API.

Inicio toma portadas del borrador, incluso sin versiones, y encuentra el PNG facial
de retratos JPEG/WebP. Recortes 1:1 por servidor al iniciar/guardar; sin rostro,
cuadrado superior centrado del lado menor. No modifica originales ni versiones.
Turbo PDD integrado posteriormente con ocho saltos; ver la entrada correspondiente.

## Regeneración puntual y separación de rasgos — 29 de octubre de 2026

Corregido: el intérprete había marcado una petición de regenerar guantes y zapatos
como imageAction generate, aunque no había cambios de ficha, activando retrato e
inventario completos. Las órdenes inequívocas de regeneración de piezas ahora se
resuelven a acciones acotadas sin interpretación de ficha: solo imágenes pedidas,
variantes seleccionadas y archivo de las anteriores. Ambigüedades no se adivinan.
Barba utiliza el maniquí de cabeza y excluye piel/facciones; las piezas blancas usan
fondo negro además del soporte negro. Maquillaje propuesto requiere confirmación
independiente basada en píxeles, omitiéndolo ante ausencia o incertidumbre sin
bloquear el resto. Documentación y pruebas con proveedores simulados actualizadas.
Pendiente de observación: calidad visual de extracciones con distintos modelos;
una comprobación independiente reduce falsos positivos, no garantiza infalibilidad.


## Controles únicos y soportes de Outfit — 29 de octubre de 2026

Implementado: selección de modelos exclusivamente en la barra superior por proyecto.
Retirados los selectores del compositor y la sección LLM de Configuración; se
conservan claves, historial y configuración interna compatible. Los avisos de
búsqueda de lore pasan a Narrativa. Activados los soportes existentes de manos
(guantes, relojes, pulseras, anillos y uñas) y pies (calzado y calcetines), con
variantes negras para componentes predominantemente blancos. Insignias agrupa
medallas y distintivos y conserva IDs, selecciones y vínculos de retratos antiguos.
Las extracciones ya guardadas se mantienen hasta regeneración explícita.
Pruebas simuladas verifican referencias, seguridad de rutas y UI sin catálogos
duplicados; no se realizan generaciones pagadas para comprobar estos cambios.


## Análisis de personajes con avances reales — 29 de octubre de 2026

Corregido el corte fijo a los 120 s de las respuestas estructuradas de personajes.
Inventario, dirección y revisión consumen SSE privado de OpenRouter y ensamblan la
respuesta completa antes de validarla. El límite configurado pasa a medir silencio
entre avances del modelo; cabeceras, rol vacío y comentarios de conexión no lo
renuevan. Máximo total de tres ventanas, acotado a cinco minutos, y límite de etapa
de la cola intacto. Cancelación aborta y libera el lector; EOF, formato roto o error
del proveedor no aplican argumentos parciales ni disparan generaciones automáticas.

Para estos análisis se prioriza throughput; chat visible e imágenes conservan
latency. Sin cambiar modelo, claves, restricciones de proveedor ni límites de
privacidad/precio. Inventario pide descripciones e instrucciones breves por pieza,
evitando repetir en cada una las reglas que el generador ya añade. Telemetría guarda
ID de generación al recibirlo y primer avance, sin contenido o razonamiento.

Verificado con el análisis real de Carlos: MiMo-V2.6-Pro, DeepInfra, primer avance
2,77 s, respuesta completa 106,5 s, once piezas válidas, cero imágenes generadas y
sin modificar el personaje. Pruebas controladas cubren actividad que supera la
antigua ventana total, silencio con keepalives, máximo absoluto, tramas partidas,
errores, cancelación y compatibilidad local. Pendiente: medir la variación de
tiempos con otros modelos y cargas; el enrutamiento no garantiza duración fija.

## Revisión de retratos sin perder la generación — 29 de octubre de 2026

Corregido el contrato de revisión de Outfit: identificadores breves por lote,
correspondencia unívoca a IDs persistidos, normalización de explicaciones y un solo
reintento de revisión ante un formato incompleto. Ningún veredicto o pieza ausente
se inventa para aceptar una foto. Los fallos registran el campo del contrato que
falló, sin guardar respuestas, imágenes ni razonamiento en logs. Revisiones v2
invalidan solamente comprobaciones antiguas, reutilizando las imágenes guardadas.
Las variaciones autorizan explícitamente la cámara frontal y A-pose que exige su
generación, conservando las exigencias de identidad, estilo y piezas seleccionadas.
El redactor rechaza instrucciones que terminan en dos puntos o enumeraciones
incompletas. Pruebas de contrato, colisión de abreviaturas y recuperación HTTP con
proveedor simulado verifican una sola generación de imagen entre reintentos.

Medición del fallo de Carlos: 4 min 3 s; la imagen tardó aproximadamente 10 s,
dirección visual 106 s y comprobaciones 127 s. Pendiente: reducir latencia del
redactor y revisión sin omitir las comprobaciones de las piezas seleccionadas.

Corregido además el criterio de comparación: piezas preservadas se verifican
contra la principal capturada, evitando falsos rechazos causados por una extracción
antigua distinta. Solo sustituciones, reaplicaciones y ediciones reciben donantes.
Una variación con catorce piezas pasa de tres consultas con 8/8/4 imágenes a una
consulta con dos imágenes, conservando las catorce comprobaciones. El proveedor
puede seguir agotando el timeout; ningún timeout dispara otra generación de foto.

Las propuestas cuya revisión falla quedan además accesibles en la papelera, sin
promoverse ni perder el checkpoint. La comprobación real posterior encontró
timeouts del proveedor de texto; no se solicitaron nuevas imágenes para esa prueba.

## Inferencia y modelos por proyecto — 29 de octubre de 2026

Implementado: modo Local/API y modelos persistidos por proyecto (Híbrido solo
como compatibilidad de lectura). API muestra selectores de LLM e imagen únicamente
en la barra superior común. El modelo de imagen elegido rige portadas,
retratos, variaciones y props. Los trabajos capturan sus ajustes al enviarse;
cambiar de proyecto o de modelo no altera la tarea aceptada. Configuración general
conserva claves y registro de tareas, sin selección de modelos. Las versiones de contenido
no revierten preferencias de inferencia. Validación de metadatos y pruebas con
proveedores simulados, sin consumo de API real.

## Extracción paralela de props — 29 de octubre de 2026

Implementado: después del retrato y del inventario, las piezas pendientes se piden juntas por API y se guardan conforme llegan. FIFO entre trabajos, reintento de solo pendientes y cancelación de todas las llamadas activas. Telemetría por etapa y marcador persistido compatibles con concurrencia. Outfit muestra el resultado parcial con contador, conserva pestaña/scroll y bloquea modificaciones durante la extracción, sin cubrir las imágenes con el loader del lote. Pruebas con catorce respuestas fuera de orden, rechazo parcial y cancelación con proveedor simulado.

Medición de Carlos: 11 min 12 s totales; unos 5 min 16 s correspondían a catorce imágenes enviadas en serie. Dirección visual: 1 min 43 s; inventario: dos llamadas al LLM, unos 3 min 17 s. La concurrencia elimina la espera acumulada entre imágenes; no garantiza el tiempo del proveedor ni modifica el modelo seleccionado. Pendiente: evaluar la latencia del redactor/análisis y registrar el motivo concreto de la segunda pasada de inventario, que hoy puede responder a validación incompleta o maquillaje incierto.

## Actividad inmediata y vistas previas verificadas — 28 de octubre de 2026

Implementado: Interpretar muestra el overlay antes de consultar motor, esperar autoguardado o aceptar el trabajo; conservar texto y liberar bloqueo si se cancela. El descubrimiento de tareas no retira actividad de un envío pendiente. Los checkpoints reutilizan el compositor y su catálogo para evitar estados intermedios y consultas repetidas. Pruebas con esperas controladas verifican actividad inmediata y restauración.

Implementado: la biblioteca publica vistas previas verificadas desde Media sin alterar datos. Inicio y mapa omiten archivos locales ausentes y muestran otro recurso disponible o el diseño sin foto; dejan de solicitar portadas/recortes inexistentes. Rutas contenidas, archivos recuperados visibles de nuevo y pruebas de conservación de datos.

## Selector de modelos durante la carga — 28 de octubre de 2026

Corregido: el compositor en modo API podía ejecutar startsWith antes de recibir su configuración al reconstruirse durante un trabajo. Valores iniciales definidos y bloqueo de actualizaciones tras desmontar; prueba de carga diferida y reconstrucción evita que el error interrumpa la observación y se repita en cada consulta. Se conservan modelos y texto del usuario.

## Entrada segura a la creación de personaje — 28 de octubre de 2026

Implementado y ajustado: Descripción/Fotografía permanecen pendientes hasta guardar la primera fotografía válida; si falla antes, vuelven a bienvenida conservando texto, adjuntos y referencia. Si la foto existe pero falla Outfit, el editor permanece disponible, también al recargar proyectos anteriores. Regenerar props aparece junto a Generar Otra: usa el modelo seleccionado y la principal capturada para una extracción nueva, conservando variantes y sin generar otro retrato. Cola, cancelación y checkpoints permiten continuar piezas faltantes de un trabajo sin repetir las ya completadas. Pruebas simuladas cubren fallos antes/después de fotografía, selección de modelo/principal, conservación, recarga y recuperación sin llamadas de pago.

## Escritura agéntica de libros — 28 de octubre de 2026

El asistente general inicia ESCRIBIR_LIBRO sobre el Story Book abierto cuando se ordena desarrollar un libro completo. POST /api/jobs/book encola un trabajo duradero kind book en la cola principal. Captura modelo, modo de inferencia, contenido esperado y petición. La escritura planifica capítulos y extensión, añade capítulos/temas/párrafos mediante operaciones de Documents, amplía escenas si falta extensión y recorre todos los párrafos por lotes para corregir continuidad. Conserva IDs existentes, metadatos, estructura y fragmentos protegidos. Cada escritura usa CAS contra el último contenido guardado, sin crear proyectos ni versiones permanentes.

El progreso es una estimación por etapas, limitado a 99 antes de terminar escritura y revisión. No se presenta como tiempo restante garantizado ni como prueba de calidad literaria. El objetivo predeterminado es 12000 palabras, configurable por la petición; hay límites de capítulos, ampliaciones y contexto. Una salida demasiado breve no se marca como completada. Una inferencia recibe el libro completo si cabe en el presupuesto conservador; para libros largos recibe notas y la sección de trabajo. La revisión recorre todas las secciones, sin afirmar lectura simultánea de contenido ausente.

La observación del chat muestra progreso y preguntas opcionales. Enter durante el trabajo envía una indicación al endpoint /api/jobs/:jobId/message y el siguiente turno la incorpora. Stop cancela la tarea, conservando borradores y abortando solicitudes activas. Cambiar de página solo dispone la observación; el servidor continúa. Al abrir el libro, el chat recupera tareas queued/running. Autosave adopta revisiones de servidor y bloquea ediciones mientras el trabajo está activo; una edición externa produce conflicto y no se sobrescribe. Reiniciar el servidor durante una llamada requiere reintento explícito según el contrato existente de la cola.

## Edición del libro, chat continuo y VRAM — 28 de octubre de 2026

Implementado: comando de edición directa del Story Book abierto, protección ante respuestas obsoletas y guardado temporal; creación explícita y bloqueo de duplicados. Importación del asistente garantiza Título, Capítulo y Tema visibles antes de párrafos. Conversación activa y borrador conservados entre proyectos/recargas; Nuevo chat reinicia solo la activa. Selector Qwen local común y Play/Stop circular con precarga real de pesos y descarga serializada. Resuelto el fallo de entrada a workspaces causado por declaraciones duplicadas tras la edición interrumpida. Pruebas DOM/HTTP y medición real de VRAM; no se restauraron los proyectos eliminados por el usuario.

## Configuración centrada en modelos — 28 de octubre de 2026

Implementado: prompts efectivos y variantes visibles en cajas compactas de solo lectura, con tooltip íntegro. Retirados edición/restauración de instrucciones y controles de presupuesto/timeout. Solo se envían modelos al guardar; el backend rechaza escrituras de prompts y conserva valores previos. Pruebas DOM y HTTP verifican la separación.

## Inferencia Local/API/Híbrido y prompts funcionales — 28 de octubre de 2026

Implementado: ComfyUI 0.43.0 headless, paquete propio Text + Tools y ajuste de referencias sin recortes. Modelos Qwen3.5 4B/9B INT8 ConvRot con visión, hashes verificados, enlazados sin copiar pesos y disponibles en Configuración. Probados con herramientas e imagen sintética usando el adaptador real.

Implementado: Local fuerza inferencia local; API mantiene destino externo y copia API; Híbrido respeta el modelo de cada función. Scope por petición, modo/configuración capturados en trabajos, cancelación dirigida y arranque oculto bajo demanda del motor propio. Sin fallback silencioso entre nube y local. Modalidades sin pesos locales se rechazan expresamente.

Implementado: catálogo de Configuración reconstruido a partir de instrucciones funcionales compartidas con runtime; fases de personaje visibles, fuentes identificadas y herencia del modelo del ayudante. Se conservan modelos guardados y personalizaciones. Catálogo y controles incluyen ambas opciones locales incluso sin red.

Pendiente: evaluar calidad en tareas complejas y contextos extensos; token streaming local; herramientas de búsqueda web local; modelos/workflows de imagen, audio y video definidos por el usuario. No descargar pesos adicionales ni activar fallback automático. Contrato en [inferencia local](architecture/LOCAL-INFERENCE.md).

## Panel reciente e historial general de tareas — 27 de octubre de 2026

Implementado: panel lateral mínimo con las diez tareas visibles más recientes y botón para ocultar cada fila sin cancelar ni borrar historial. Eliminado el párrafo informativo permanente. Historial completo y paginado en Configuración general, con tiempos y eliminación individual de registros terminados. La ocultación persiste al recargar/reiniciar, y la cola ya no descarta automáticamente registros antiguos. Validación de propietario de registro y protección de trabajos activos; proyectos, fotos y piezas se conservan.

## Disponibilidad de creación de personaje — 27 de octubre de 2026

Implementado: Opciones e Ingredientes se muestran como «Próximamente» y no son seleccionables desde la UI; Descripción y Fotografía siguen disponibles. Las cuatro vías y sus operaciones internas permanecen implementadas. Las fichas antiguas solicitadas se reclasificaron a Descripción con respaldo local y control de revisiones, conservando versiones históricas, fotos y props.

Pendiente para la próxima versión: habilitar nuevamente las entradas UI de Opciones e Ingredientes y validar ambos recorridos completos antes de su lanzamiento.

La entrada de producto sigue siendo `public/roadmap.html`. La página se organiza
en tres niveles: visión, diseño general del flujo y explorador de tareas.

- La visión resume el objetivo audiovisual de Kubrick Space. Sus cifras proceden de
  las tareas documentadas; las marcas personales no aumentan las implementaciones verificadas.
- El diseño general muestra Historia → Guión → Película e ingredientes compartidos.
  Describe el destino del producto, no afirma que todas esas capacidades estén terminadas.
- El recorrido agrupa capacidades y enlaza con su área del explorador. No fija fechas de entrega.
- El explorador conserva identificadores, estados y marcas locales. Combina proyecto,
  área, búsqueda sin acentos, estado y prioridad. Una tarea sin prioridad explícita
  permanece sin clasificar; la presentación no asigna prioridades automáticamente.
- Los detalles conservan alcance y enlaces. Las tareas verificadas no pueden
  reabrirse por una marca antigua del navegador. Las referencias se distinguen del trabajo marcado.

## Diseño y rendimiento

Se utilizan los colores, controles, SVG originales y material de vidrio compartidos.
El parallax mueve solo dos capas decorativas mediante transforms y requestAnimationFrame
cuando hay scroll. No se intercepta la rueda ni se anima cada tarjeta. IntersectionObserver
revela las secciones generales; todo permanece visible si esa API o JavaScript no están disponibles.

`prefers-reduced-motion` desactiva desplazamientos, transiciones y contadores animados,
incluyendo cambios de preferencia con la página abierta. Los recursos se liberan al salir.
En pantallas pequeñas, los filtros de proyecto/área están en un panel plegable; las
tareas y los controles mantienen su navegación por teclado.

## Mantener la página

Actualizar el inventario en HTML y conservar `data-roadmap-id` al mover tareas.
No duplicar checkboxes para crear resúmenes: los indicadores se calculan desde las
tareas originales. Las marcas locales usan `kai-roadmap-progress-v1`; cambiar de
presentación no borra ese seguimiento. JS y CSS pertenecen al módulo UI.

Verificación: `npm run check`, pruebas de filtros/estado/movimiento reducido y
recorrido en Edge en oscuro/claro a 1440, 1024, 768, 390 y 320 px, sin desbordamiento
horizontal. La evidencia local está en `.system_generated/reports/roadmap-design-browser-result.json`.
Resultado del 21 de octubre de 2026: 360 pruebas aprobadas y ningún error de navegador.

## Personajes: capas, soportes y lore opcional — 27 de octubre de 2026

Implementado: cabeza neutra para accesorios, grupos independientes Camisetas/Camisetas interiores, selección múltiple de ropa/props con vínculos por retrato y composición validada. Aviso de lore visible con OK/Cancelar/Recordar luego y aprobación por hecho; los hechos físicos generan referencias opcionales en Outfit/catálogo universal mediante la cola principal, sin cambiar la apariencia. Pruebas de datos temporales y navegador; evaluación visual de extracciones reales sigue dependiendo del modelo y de la aprobación del usuario.

## Fiabilidad de Aplicar Outfit — 27 de octubre de 2026

Corregido el rechazo de revisiones JSON válidas que el proveedor devolvía sin tool_calls. Esquema estricto compartido, huella de composición y reanudación de revisión pendiente al repetir Apply sin cambios, conservando job e imágenes. Diagnóstico acotado para distinguir formato de rechazo visual. Validación con reproducción sintética y recorrido HTTP, sin regenerar retratos reales del usuario.

## Tiempos y proveedores — 27 de octubre de 2026

Implementado: Desglose de tiempos en Tareas activas para trabajos nuevos de personajes, con cola local, ejecución, etapas, solicitudes, proveedor/modelo e ID de generación cuando se informan. Persistencia de intentos y checkpoints reutilizados, metadata asíncrona acotada y ausencia explícita de mediciones históricas. OpenRouter prioriza latencia entre proveedores compatibles del modelo elegido, sin preferencia fija por fabricante ni cambio de modelo. Verificado con proveedores simulados y navegador oscuro/claro; no se afirma una mejora de velocidad medida en generación real.

## Biblioteca universal independiente — 27 de octubre de 2026

Implementado: acceso lateral bajo Ingredientes en Personajes, categorías Rasgos/Ropa/Props, filtros por grupo/personaje y vista previa. Almacenamiento raster independiente y conservación opcional al eliminar definitivamente proyectos (marcada por defecto). Papelera de biblioteca separada, selección múltiple permanente, restauración y purga confirmada. Referencias retiradas se ocultan de Outfit y ofrecen regeneración, conservando fotos y vínculos históricos; protección frente a autosave obsoleto. Pruebas con archivos temporales y Edge, sin generación pagada.

## Acciones rápidas y códigos de piezas — 27 de octubre de 2026

Implementado: X de desvinculación al hover en Outfit conservando biblioteca/historial, preview izquierdo y papelera individual derecha; papelera rápida también en el explorador universal. Props tiene reloj propio y Todo/acceso lateral conservan su retícula. Códigos #XXXX persistentes, copiados con clic y compartidos por copias de una misma pieza; reserva mientras están activas o en papelera. Gestión común de asistentes admite búsqueda, importación, edición, selección, reciclaje y regeneración por código, con rechazo de ambigüedades. Verificado con proveedores simulados, almacenamiento temporal y navegador oscuro/claro.

## Tags editables y resumen visual de Diseño — 27 de octubre de 2026

Implementado: doble clic para editar tags personalizados, validación de disponibilidad y expectedCode en servidor, reversa ante rechazo, reserva en papelera y liberación tras purga. Assistentes fijan UUID para impedir que un tag reutilizado redirija planes antiguos. Diseño muestra pestañas y dimensiones antes de miniaturas; títulos/descripciones individuales pasan a tooltips accesibles y el resumen general queda al final. Restaurado el vidrio compartido del chat conservando la ausencia de textura dotted propia. Pruebas de concurrencia y reutilización con datos temporales; navegador verifica edición, cancelación, rechazo, copia, orden y tooltip sin llamadas pagadas.

## Recuperación de dirección visual y observación — 28 de octubre de 2026

El redactor de dirección visual admite hasta cuatro propuestas compose_character_portrait de una misma respuesta: todas deben validar naturaleza, conjunto único de atributos y prompt. Las propuestas solo contienen texto; se usa la última validada para una única generación. Propuestas idénticas se deduplican. Herramientas desconocidas o propuestas incompatibles se rechazan; hay una única corrección de texto con el mismo modelo, sin regenerar imágenes ni reintentar errores de proveedor. parallel_tool_calls=false se envía únicamente si el catálogo declara soporte, evitando el 404 de MiMo con require_parameters. El alcance compara conjuntos únicos, no el orden de claves.

Las consultas de tareas y residencia son silenciosas en consola. El descubrimiento de personaje inactivo ocurre cada 15 segundos y no se solapa con otra consulta; la observación de un trabajo activo conserva su frecuencia. Los avisos sin clave explícita se deduplican por mensaje en la sesión; los de trabajos por ID/estado/error, sin depender de updatedAt. Ningún sondeo relanza generaciones.

## Completado — 29 octubre 2026: catálogos API

- Selector Local/API por proyecto, con lectura compatible del modo híbrido antiguo.
- Catálogo de imágenes de claves conectadas, filtro de edición multirreferencia, grupos por proveedor y precio fijo/desde/variable.
- Validación autoritativa y ejecución del modelo seleccionado, caché por credenciales y adaptadores Images de OpenRouter/OpenAI, Replicate y Gemini.

## Completado — 29 octubre 2026: selector enriquecido compartido

- Configuración, toolbar y compositor comparten búsqueda, órdenes, precios, filtro y ranking.
- Rankings de imagen Artificial Analysis separados por Elo de edición y generación, con coincidencias inequívocas y clave solo en servidor.

## Completado — 29 octubre 2026: autoría directa en el documento activo

- Órdenes de ampliación/edición incluidas formas con pronombres activan la cola, sin propuesta ni confirmación en chat.
- Planificación y edición de capítulos existentes, contexto del autor, IDs autoritativos, protección y revisión incremental.
- Recursos complementarios de personaje/escenario preparados y vinculados durante el ciclo.
- Insignias Elo de imágenes visibles únicamente con Ranking marcado.

## Completado — 29 octubre 2026: persistencia de motores del catálogo

- Contrato único de proveedor/modelo para preferencias, borradores/versiones y trabajos de personajes.
- Eliminada la lista antigua Muse/Seedream que bloqueaba Flux Klein y recuperación de borradores.
- Compatibilidad efectiva comprobada en generación, manteniendo recuperación y guardado independientes de red.


### Guión — campos cinematográficos (30-10-2026)

Implementado: título sin sticky, escenas independientes, campos de texto que
permanecen al vaciarse, nombre de personaje separado del selector de voz,
selector de plano y escenarios de proyectos con opción Personalizado. Sin ficha
narrativa adicional. Se conservan JSON, contexto, exportación, historial e IDs.

Generación desde ingredientes alineada con ese mismo formato: instrucciones
cinematográficas, conversión canónica antes de aplicar, escenarios conocidos o
personalizados, voces tipadas y origen de versión conservado. La plantilla nueva
mantiene campos vacíos sin texto de ayuda persistido.
