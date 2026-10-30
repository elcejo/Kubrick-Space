import { renderIcon } from '../../icons.js';
import { trapCoverFocus } from './cover-workflow.js';
import { safeHTML } from '../../safe-html.js';

/** Owns cropper DOM and lifecycle; context is the explicit editor integration contract. */
export class EditorCropper {
  cropperCleanup = null;
  constructor(context) {
    this.context = context;
  }

  destroy() {
    this.cropperCleanup?.();
    this.cropperCleanup = null;
  }

  showCropperModal(imageSrc, callback) {
    this.cropperCleanup?.();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay editor-cropper-overlay';

    const content = document.createElement('div');
    content.className = 'modal-content glass-heavy editor-modal editor-modal--cropper';

    content.innerHTML = safeHTML(`
      <div class="editor-modal__title">
        <span>${renderIcon('crop')}</span> Recortar Imagen (Proporción 2:3)
      </div>
      <p class="editor-modal__description">
        Arrastra el recuadro para moverlo. Arrastra los círculos de las esquinas para cambiar el tamaño.
      </p>

      <div class="editor-cropper-stage">
        <canvas id="cropper-canvas" class="editor-cropper-canvas"></canvas>
      </div>

      <div class="editor-modal__actions">
        <button id="cropper-cancel" class="btn btn-ghost editor-modal__button">Cancelar</button>
        <button id="cropper-save" class="btn btn-primary editor-modal__button editor-modal__button--accent">Recortar y Guardar</button>
      </div>
    `);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('#cropper-canvas');
    const ctx = canvas.getContext('2d');

    const img = new Image();
    let closed = false;
    let removeDragListeners = () => {};
    let releaseFocus = () => {};
    const cleanup = () => {
      if (closed) return;
      closed = true;
      img.onload = null;
      img.onerror = null;
      removeDragListeners();
      overlay.querySelector('#cropper-save').onclick = null;
      overlay.remove();
      releaseFocus();
      if (this.cropperCleanup === cleanup) this.cropperCleanup = null;
    };
    this.cropperCleanup = cleanup;
    const cancel = () => {
      if (!closed) {
        cleanup();
        callback(null);
      }
    };
    overlay.querySelector('#cropper-cancel').addEventListener('click', cancel);
    releaseFocus = trapCoverFocus(overlay, cancel);
    img.onerror = cancel;
    img.onload = () => {
      if (closed) return;
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      // Scale image to fit inside a max 320x320 area
      const stage = canvas.parentElement;
      const stageStyle = stage.ownerDocument.defaultView.getComputedStyle(stage);
      const maxW = Math.max(
        1,
        Math.min(
          320,
          stage.clientWidth
            ? stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight)
            : 320,
        ),
      );
      const maxH = 320;

      let wp = maxW;
      let hp = maxH;
      const ar = imgW / imgH;

      if (ar > maxW / maxH) {
        wp = maxW;
        hp = maxW / ar;
      } else {
        hp = maxH;
        wp = maxH * ar;
      }

      // Set canvas dimensions
      canvas.width = wp;
      canvas.height = hp;
      canvas.style.width = `${wp}px`;
      canvas.style.height = 'auto';

      // Initialize crop box to be as large as possible with 2:3 ratio inside wp x hp
      let wb = wp;
      let hb = wb * 1.5;

      if (hb > hp) {
        hb = hp;
        wb = hb / 1.5;
      }

      let xb = (wp - wb) / 2;
      let yb = (hp - hb) / 2;

      let dragMode = null; // 'move', 'tl', 'tr', 'bl', 'br'
      let dragStart = { x: 0, y: 0 };

      const S = imgW / wp;

      const draw = () => {
        ctx.clearRect(0, 0, wp, hp);
        // Draw base image
        ctx.drawImage(img, 0, 0, wp, hp);

        // Draw overlay shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, wp, hp);

        // Draw clear preview area
        ctx.save();
        ctx.beginPath();
        ctx.rect(xb, yb, wb, hb);
        ctx.clip();
        ctx.drawImage(img, 0, 0, wp, hp);
        ctx.restore();

        // Draw crop box border
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(xb, yb, wb, hb);

        // Draw corner handles
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        const corners = [
          { x: xb, y: yb },
          { x: xb + wb, y: yb },
          { x: xb, y: yb + hb },
          { x: xb + wb, y: yb + hb },
        ];

        corners.forEach((c) => {
          ctx.beginPath();
          ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      };

      draw();

      const getCoords = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
          x: (clientX - rect.left) * (canvas.width / rect.width),
          y: (clientY - rect.top) * (canvas.height / rect.height),
        };
      };

      const onStart = (e) => {
        const { x: mx, y: my } = getCoords(e);

        const handles = {
          tl: { x: xb, y: yb },
          tr: { x: xb + wb, y: yb },
          bl: { x: xb, y: yb + hb },
          br: { x: xb + wb, y: yb + hb },
        };

        let foundHandle = null;
        for (const [key, pos] of Object.entries(handles)) {
          const dx = mx - pos.x;
          const dy = my - pos.y;
          if (dx * dx + dy * dy <= 12 * 12) {
            foundHandle = key;
            break;
          }
        }

        if (foundHandle) {
          dragMode = foundHandle;
        } else if (mx >= xb && mx <= xb + wb && my >= yb && my <= yb + hb) {
          dragMode = 'move';
          dragStart = { x: mx - xb, y: my - yb };
        } else {
          dragMode = null;
        }

        if (dragMode) {
          e.preventDefault();
        }
      };

      const onMove = (e) => {
        if (!dragMode) {
          const { x: mx, y: my } = getCoords(e);
          const handles = {
            tl: { x: xb, y: yb },
            tr: { x: xb + wb, y: yb },
            bl: { x: xb, y: yb + hb },
            br: { x: xb + wb, y: yb + hb },
          };
          let foundHandle = null;
          for (const [key, pos] of Object.entries(handles)) {
            const dx = mx - pos.x;
            const dy = my - pos.y;
            if (dx * dx + dy * dy <= 12 * 12) {
              foundHandle = key;
              break;
            }
          }

          if (foundHandle === 'tl' || foundHandle === 'br') {
            canvas.style.cursor = 'nwse-resize';
          } else if (foundHandle === 'tr' || foundHandle === 'bl') {
            canvas.style.cursor = 'nesw-resize';
          } else if (mx >= xb && mx <= xb + wb && my >= yb && my <= yb + hb) {
            canvas.style.cursor = 'move';
          } else {
            canvas.style.cursor = 'default';
          }
          return;
        }

        const { x: mx, y: my } = getCoords(e);
        const minW = 50;

        if (dragMode === 'move') {
          let newX = mx - dragStart.x;
          let newY = my - dragStart.y;

          if (newX < 0) newX = 0;
          if (newY < 0) newY = 0;
          if (newX + wb > wp) newX = wp - wb;
          if (newY + hb > hp) newY = hp - hb;

          xb = newX;
          yb = newY;
        } else if (dragMode === 'br') {
          let newW = mx - xb;
          const maxW = Math.min(wp - xb, (hp - yb) / 1.5);
          newW = Math.max(minW, Math.min(newW, maxW));
          wb = newW;
          hb = wb * 1.5;
        } else if (dragMode === 'bl') {
          const r = xb + wb;
          const t = yb;
          let newW = r - mx;
          const maxW = Math.min(r, (hp - t) / 1.5);
          newW = Math.max(minW, Math.min(newW, maxW));
          wb = newW;
          hb = wb * 1.5;
          xb = r - wb;
        } else if (dragMode === 'tr') {
          const l = xb;
          const b = yb + hb;
          let newW = mx - l;
          const maxW = Math.min(wp - l, b / 1.5);
          newW = Math.max(minW, Math.min(newW, maxW));
          wb = newW;
          hb = wb * 1.5;
          yb = b - hb;
        } else if (dragMode === 'tl') {
          const r = xb + wb;
          const b = yb + hb;
          let newW = r - mx;
          const maxW = Math.min(r, b / 1.5);
          newW = Math.max(minW, Math.min(newW, maxW));
          wb = newW;
          hb = wb * 1.5;
          xb = r - wb;
          yb = b - hb;
        }

        draw();
        e.preventDefault();
      };

      const onEnd = () => {
        dragMode = null;
      };

      canvas.addEventListener('mousedown', onStart);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);

      canvas.addEventListener('touchstart', onStart, { passive: false });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);

      removeDragListeners = () => {
        canvas.removeEventListener('mousedown', onStart);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        canvas.removeEventListener('touchstart', onStart);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      };
      const saveBtn = overlay.querySelector('#cropper-save');
      saveBtn.onclick = () => {
        const outCanvas = document.createElement('canvas');
        outCanvas.width = 1000;
        outCanvas.height = 1500;
        const outCtx = outCanvas.getContext('2d');

        const cropX = xb * S;
        const cropY = yb * S;
        const cropW = wb * S;
        const cropH = hb * S;

        outCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, 1000, 1500);

        const croppedBase64 = outCanvas.toDataURL('image/png');

        cleanup();
        callback(croppedBase64);
      };
    };

    img.src = imageSrc;
  }
}
