# Presentación y seguimiento del roadmap

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
