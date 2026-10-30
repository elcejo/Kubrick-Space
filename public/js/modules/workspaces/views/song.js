import { renderIcon } from '../../../icons.js';
import { safeHTML } from '../../../safe-html.js';
import { AppState } from '../../../app-state.js';
import { Mode } from '../../../contracts/editor-mode.js';
import { createEditorSurface, createEditableDocumentSurface } from '../../ui/document-surfaces.js';

export function renderSingleSongMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface(
      'preview',
      'animate-fadeIn surface-flex-col surface-align-center surface-gap-20 surface-p-12',
    );
    div.innerHTML = safeHTML(`
        <div class="preview-audio-player-header">
          <div class="preview-vinyl-container">
            <div id="vinyl-disc-single" class="preview-vinyl-disc">
              <div class="preview-vinyl-label"></div>
            </div>
          </div>
          <div class="preview-player-details">
            <h3 class="preview-project-title--large">${AppState.currentProject?.name || 'Sencillo'}</h3>
            <p class="preview-project-subtitle--prominent">Sencillo Independiente • Kubrick Space Audio</p>
            <div class="preview-player-controls">
              <button class="btn-primary preview-player-button" id="btn-single-play">Play</button>
              <button class="btn-ghost preview-player-button" id="btn-single-pause">Pause</button>
              <span class="preview-timecode" id="single-timer">00:00 / 03:14</span>
            </div>
            <div class="preview-audio-progress-track">
              <div class="preview-progress-fill" id="single-progress"></div>
            </div>
          </div>
        </div>

        <div class="preview-mixer-section">
          <h4 class="preview-subsection-title">Mezclador de Single (Mixer)</h4>
          <div class="preview-mixer-controls">
            <div class="preview-control-row">
              <span class="preview-control-label">Voz (Lead):</span>
              <input type="range" class="preview-mixer-slider" value="80">
            </div>
            <div class="preview-control-row">
              <span class="preview-control-label">Melodía (Synth):</span>
              <input type="range" class="preview-mixer-slider" value="70">
            </div>
            <div class="preview-control-row">
              <span class="preview-control-label">Base (Beats):</span>
              <input type="range" class="preview-mixer-slider" value="90">
            </div>
          </div>
        </div>
      `);

    const vDisc = div.querySelector('#vinyl-disc-single');
    const btnPlay = div.querySelector('#btn-single-play');
    const btnPause = div.querySelector('#btn-single-pause');
    const timer = div.querySelector('#single-timer');
    const progress = div.querySelector('#single-progress');
    let playInterval = null;
    let seconds = 0;
    view.previewCleanup = () => {
      clearInterval(playInterval);
      playInterval = null;
    };

    btnPlay.addEventListener('click', () => {
      vDisc.classList.add('is-playing');
      if (!playInterval) {
        playInterval = setInterval(() => {
          seconds++;
          if (seconds >= 194) seconds = 0;
          const m = Math.floor(seconds / 60)
            .toString()
            .padStart(2, '0');
          const s = Math.floor(seconds % 60)
            .toString()
            .padStart(2, '0');
          timer.textContent = `${m}:${s} / 03:14`;
          progress.style.setProperty('--progress', `${(seconds / 194) * 100}%`);
        }, 1000);
      }
    });

    btnPause.addEventListener('click', () => {
      vDisc.classList.remove('is-playing');
      if (playInterval) {
        clearInterval(playInterval);
        playInterval = null;
      }
    });

    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML: '<h1>Letra de la canción</h1><p>[Intro]</p><p>Escribe los versos aquí...</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Estructura de Arreglo</h3>
        <table class="preview-data-table">
          <thead>
            <tr class="preview-table-header-row">
              <th class="preview-table-cell">Sección</th>
              <th class="preview-table-cell">Duración</th>
              <th class="preview-table-cell">Clave / Acorde</th>
              <th class="preview-table-cell">Intensidad</th>
            </tr>
          </thead>
          <tbody>
            <tr class="preview-table-row">
              <td class="preview-table-highlight">Intro</td>
              <td class="preview-table-cell">8 compases</td>
              <td class="preview-table-cell">Am</td>
              <td class="preview-table-cell">Suave (Baja)</td>
            </tr>
            <tr class="preview-table-row">
              <td class="preview-table-accent">Verso 1</td>
              <td class="preview-table-cell">16 compases</td>
              <td class="preview-table-cell">Am - F - C - G</td>
              <td class="preview-table-cell">Moderada (Media)</td>
            </tr>
          </tbody>
        </table>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}

export function renderAlbumSongMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-16 surface-p-12');
    div.innerHTML = safeHTML(`
        <div class="preview-album-header">
          <div class="preview-album-art">${renderIcon('disc')}</div>
          <div class="preview-player-details">
            <h3 class="preview-project-title">${AppState.currentProject?.name || 'Álbum'}</h3>
            <p class="preview-project-subtitle">Álbum Completo • Tracklist</p>
            <div class="preview-recording-progress-track">
              <div class="preview-recording-progress-fill"></div>
            </div>
            <span class="preview-progress-note">Progreso de grabación: 40% (4 de 10 canciones)</span>
          </div>
        </div>

        <div class="preview-content-section">
          <h4 class="preview-subsection-title--compact">Pistas en desarrollo</h4>
          <div class="preview-track-list">
            <div class="preview-track-row">
              <span>1. Introducción al Vacío</span>
              <span class="preview-track-status">02:40 • Grabado</span>
            </div>
            <div class="preview-track-row">
              <span>2. Resonancia Estelar</span>
              <span class="preview-track-status">04:15 • Grabado</span>
            </div>
            <div class="preview-track-row">
              <span>3. Viento Solar</span>
              <span class="preview-track-status">03:50 • En mezcla</span>
            </div>
          </div>
        </div>
      `);
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML:
        '<h1>Estructura del Álbum</h1><h2>Concepto Artístico</h2><p>Escribe la temática global...</p><h2>Lista de Pistas</h2><p>1. Track 1<br>2. Track 2</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Ficha Técnica del Álbum</h3>
        <table class="preview-data-table">
          <thead>
            <tr class="preview-table-header-row">
              <th class="preview-table-cell--compact">Pista</th>
              <th class="preview-table-cell--compact">Duración</th>
              <th class="preview-table-cell--compact">Tempo (BPM)</th>
              <th class="preview-table-cell--compact">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr class="preview-table-row">
              <td class="preview-table-label">1. Intro</td>
              <td class="preview-table-cell--compact">02:40</td>
              <td class="preview-table-cell--compact">90 BPM</td>
              <td class="preview-table-success">Listo</td>
            </tr>
            <tr class="preview-table-row">
              <td class="preview-table-label">2. Resonancia</td>
              <td class="preview-table-cell--compact">04:15</td>
              <td class="preview-table-cell--compact">120 BPM</td>
              <td class="preview-table-success">Listo</td>
            </tr>
          </tbody>
        </table>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}

export function renderSoundtrackSongMode(view, mode) {
  const node = view.context.node;
  if (!node) return;

  if (mode === Mode.PREVIEW) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-16 surface-p-12');
    div.innerHTML = safeHTML(`
        <div>
          <h3 class="preview-project-title">${AppState.currentProject?.name || 'Soundtrack'}</h3>
          <p class="preview-project-subtitle--quiet">Banda Sonora Original (OST) Mixer</p>
        </div>

        <div class="preview-content-section">
          <h4 class="preview-subsection-title--uppercase">Mezclador Temático</h4>
          <div class="preview-mixer-controls">
            <div class="preview-control-row">
              <span class="preview-control-label--wide">Orquesta / Cuerdas:</span>
              <input type="range" class="preview-mixer-slider--gold" value="85">
            </div>
            <div class="preview-control-row">
              <span class="preview-control-label--wide">Efectos Ambientales:</span>
              <input type="range" class="preview-mixer-slider--accent" value="50">
            </div>
            <div class="preview-control-row">
              <span class="preview-control-label--wide">Piano Lead:</span>
              <input type="range" class="preview-mixer-slider--green" value="75">
            </div>
          </div>
        </div>
      `);
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.WYSIWYG) {
    const div = createEditableDocumentSurface({
      htmlContent: view.context.htmlContent,
      fallbackHTML:
        '<h1>Cues de la Banda Sonora</h1><h2>Tema Central</h2><p>[00:00 - 02:00] Descripción de la orquestación y tempo...</p><h2>Tema de Suspenso</h2><p>[02:00 - 04:00] Texturas oscuras y sintetizadores...</p>',
      onInput: () => view.context.emitChange(),
    });
    view.context.surface = div;
    node.appendChild(div);
  } else if (mode === Mode.MARKDOWN) {
    const div = createEditorSurface('preview', 'animate-fadeIn surface-flex-col surface-gap-12');
    div.innerHTML = safeHTML(`
        <h3 class="preview-section-title">Cue Sheet</h3>
        <table class="preview-data-table">
          <thead>
            <tr class="preview-table-header-row">
              <th class="preview-table-cell--compact">Timecode</th>
              <th class="preview-table-cell--compact">Nombre Cue</th>
              <th class="preview-table-cell--compact">Atmósfera</th>
            </tr>
          </thead>
          <tbody>
            <tr class="preview-table-row">
              <td class="preview-table-timecode">00:00 - 01:30</td>
              <td class="preview-table-label">Apertura</td>
              <td class="preview-table-cell--compact">Melancólica, Orquestal</td>
            </tr>
            <tr class="preview-table-row">
              <td class="preview-table-timecode">01:30 - 03:00</td>
              <td class="preview-table-label">Persecución</td>
              <td class="preview-table-cell--compact">Tensa, Percusión rápida</td>
            </tr>
          </tbody>
        </table>
      `);
    view.context.surface = div;
    node.appendChild(div);
  }
}
