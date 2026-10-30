import { renderIcon } from '../../../icons.js';
import { safeHTML } from '../../../safe-html.js';
import { AppState } from '../../../app-state.js';
import { Mode } from '../../../contracts/editor-mode.js';
import { createEditorSurface, createEditableDocumentSurface } from '../../ui/document-surfaces.js';

export function renderShortFilmVideoMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <div class="preview-video-player" id="player-box-short">
          <div class="preview-video-player__header">
            <span>${AppState.currentProject?.name || 'Cortometraje'}</span>
            <span>HD 1080p</span>
          </div>
          <div class="preview-play-control" id="player-icon-short">${renderIcon('play')}</div>
          <div class="preview-video-player__controls">
            <div class="preview-video-player__scrub-track" id="video-scrub-bar-short">
              <div class="preview-progress-fill" id="video-progress-short"></div>
            </div>
            <div class="preview-video-player__status">
              <span>00:00 / 12:30</span>
              <span>${renderIcon('volume')}</span>
            </div>
          </div>
        </div>
      `);

    const pIcon = div.querySelector('#player-icon-short');
    const progress = div.querySelector('#video-progress-short');
    let playInterval = null;
    let secs = 0;
    view.previewCleanup = () => {
      clearInterval(playInterval);
      playInterval = null;
    };

    pIcon.addEventListener('click', () => {
      if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
        pIcon.innerHTML = safeHTML(renderIcon('play'));
      } else {
        pIcon.innerHTML = safeHTML(renderIcon('pause'));
        playInterval = setInterval(() => {
          secs += 15;
          if (secs > 750) {
            secs = 0;
            clearInterval(playInterval);
            playInterval = null;
            pIcon.innerHTML = safeHTML(renderIcon('play'));
          }
          progress.style.setProperty('--progress', `${(secs / 750) * 100}%`);
        }, 1000);
      }
    });

    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML:
        '<h2>ESCENA 1 - INT. UBICACIÓN - DÍA</h2><p>Escribe los diálogos y acciones del cortometraje aquí...</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Desglose de Escenas</h3>
        <table class="preview-data-table">
          <thead>
            <tr class="preview-table-header-row">
              <th class="preview-table-cell--compact">Escena</th>
              <th class="preview-table-cell--compact">Ubicación</th>
              <th class="preview-table-cell--compact">Día/Noche</th>
            </tr>
          </thead>
          <tbody>
            <tr class="preview-table-row">
              <td class="preview-table-label">Escena 1</td>
              <td class="preview-table-cell--compact">Habitación Principal</td>
              <td class="preview-table-cell--compact">Día</td>
            </tr>
          </tbody>
        </table>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}

export function renderDocumentaryVideoMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-16 surface-p-12');
    div.innerHTML = safeHTML(`
        <div>
          <h3 class="preview-project-title">${AppState.currentProject?.name || 'Documental'}</h3>
          <p class="preview-project-subtitle--quiet">Planificación y Registro Documental</p>
        </div>

        <div class="preview-content-section">
          <h4 class="preview-subsection-title--compact">Entrevistas programadas</h4>
          <div class="preview-control-stack">
            <label class="checkbox-wrapper preview-interview-option">
              <input type="checkbox" checked disabled>
              <span>Entrevista 1: Investigador Científico (Completado)</span>
            </label>
            <label class="checkbox-wrapper preview-interview-option">
              <input type="checkbox" disabled>
              <span>Entrevista 2: Testigo Local (Pendiente de confirmar)</span>
            </label>
          </div>
        </div>
      `);
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML:
        '<h1>Guión de Documental</h1><h2>Tema / Tesis</h2><p>Escribe el núcleo narrativo del documental...</p><h2>Preguntas de Entrevista</h2><p>Formula las preguntas principales aquí...</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Ficha de Archivo Histórico</h3>
        <p class="preview-description">Lista de grabaciones, cintas analógicas o documentos a escanear.</p>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}

export function renderMusicVideoVideoMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-16 surface-p-12');
    div.innerHTML = safeHTML(`
        <div>
          <h3 class="preview-project-title">${AppState.currentProject?.name || 'Videoclip Musical'}</h3>
          <p class="preview-project-subtitle--quiet">Sincronización de Audio & Ritmo Visual</p>
        </div>
        <p class="preview-empty-state">Visualiza los compases de tu canción sincronizados con el editor de abajo...</p>
      `);
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML:
        '<h1>Tratamiento del Videoclip</h1><h2>Concepto Visual</h2><p>Describe el estilo visual del videoclip...</p><h2>Escena / Ritmo de Edición</h2><p>[00:00 - 00:30] Compases rápidos. Transiciones rápidas...</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Cue Sheet de Compases</h3>
        <table class="preview-data-table">
          <thead>
            <tr class="preview-table-header-row">
              <th class="preview-table-cell--compact">Tiempo</th>
              <th class="preview-table-cell--compact">Acción Visual</th>
            </tr>
          </thead>
          <tbody>
            <tr class="preview-table-row">
              <td class="preview-table-timecode">00:00 - 00:10</td>
              <td class="preview-table-cell--compact">Entrada de luces de neón en sincronía con el bajo</td>
            </tr>
          </tbody>
        </table>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}

export function renderAnimationVideoMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-16 surface-p-12');
    div.innerHTML = safeHTML(`
        <div>
          <h3 class="preview-project-title">${AppState.currentProject?.name || 'Animación'}</h3>
          <p class="preview-project-subtitle--quiet">Storyboard & Animática 2D/3D</p>
        </div>
        <div class="preview-storyboard-grid">
          <div class="preview-storyboard-frame">${renderIcon('brush')} Frame 1</div>
          <div class="preview-storyboard-frame">${renderIcon('brush')} Frame 2</div>
          <div class="preview-storyboard-frame">${renderIcon('plus')} Agregar</div>
        </div>
      `);
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML:
        '<h1>Diseño de Animación</h1><h2>Hojas de Personajes (Model Sheet)</h2><p>Dibuja y describe los giros de cámara de los personajes...</p><h2>Planificación de Keyframes</h2><p>Detalla los cuadros clave del animático aquí...</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Planilla de Fotogramas Clave</h3>
        <p class="preview-description">Configura el número de fotograma clave (Keyframe #) y sus interpolaciones de movimiento.</p>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}
