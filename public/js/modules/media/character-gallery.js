import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { MediaTrashSelection, mediaSelectionMarker } from '../../media-selection.js';

/** Fit shortest-column masonry inside an unscaled canvas node, without cropping. */
export function fitCharacterGallery(ratios, width, height) {
  if (!ratios.length || width <= 0 || height <= 0) return [];
  const aspects = ratios.map((ratio) => (Number.isFinite(ratio) && ratio > 0 ? ratio : 2 / 3));
  const gap = Math.min(12, width / (Math.sqrt(aspects.length) * 8), height / 16);
  let best = null;
  for (let columns = 1; columns <= Math.min(aspects.length, 64); columns++) {
    const tileWidth = (width - gap * (columns - 1)) / columns;
    if (tileWidth <= 0) break;
    const bottoms = Array(columns).fill(0);
    const tiles = aspects.map((ratio) => {
      const column = bottoms.indexOf(Math.min(...bottoms));
      const y = bottoms[column];
      const tileHeight = tileWidth / ratio;
      bottoms[column] += tileHeight + gap;
      return { x: column * (tileWidth + gap), y, width: tileWidth, height: tileHeight };
    });
    const totalHeight = Math.max(...bottoms) - gap;
    const scale = Math.min(1, height / totalHeight);
    const area = aspects.reduce((sum, ratio) => sum + (tileWidth * scale) ** 2 / ratio, 0);
    const fullWidth = scale === 1;
    // Prefer layouts that use all available width; fall back to contain for a single tall photo.
    if (!best || (fullWidth && !best.fullWidth) || (fullWidth === best.fullWidth && area > best.area))
      best = { tiles, scale, area, fullWidth, totalHeight };
  }
  const offsetX = (width - width * best.scale) / 2;
  const offsetY = (height - best.totalHeight * best.scale) / 2;
  return best.tiles.map((tile) => ({
    x: offsetX + tile.x * best.scale,
    y: offsetY + tile.y * best.scale,
    width: tile.width * best.scale,
    height: tile.height * best.scale,
  }));
}

/** Character image presentation. Viewing is transient; only explicit actions edit the draft. */
export class CharacterImageGallery {
  constructor(container, actions) {
    this.container = container;
    this.actions = actions;
    this.previewUrl = null;
    this.showTrash = false;
    this.trashSelection = new MediaTrashSelection(() => this.render(this.project));
    this.returnUrl = null;
    this.dimensions = new Map();
    this.view = container.ownerDocument.defaultView;
    this.frame = null;
    this.resizeObserver = this.view.ResizeObserver
      ? new this.view.ResizeObserver(() => this.scheduleLayout())
      : null;
    this.destroyed = false;
    this.keydown = (event) => {
      if (event.key === 'Escape' && this.previewUrl && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    };
    container.addEventListener('keydown', this.keydown);
  }

  scheduleLayout() {
    if (this.destroyed || this.frame !== null) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = null;
      this.layout();
    });
  }

  layout() {
    const grid = this.container.querySelector('.character-gallery__grid');
    if (this.destroyed || !grid) return;
    const tiles = [...grid.querySelectorAll('.character-gallery__tile')];
    const boxes = fitCharacterGallery(
      tiles.map((tile) => this.dimensions.get(tile.dataset.imageUrl) || 2 / 3),
      grid.clientWidth,
      grid.clientHeight,
    );
    tiles.forEach((tile, index) => {
      const box = boxes[index];
      if (!box) return;
      Object.assign(tile.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
      tile.classList.toggle('is-compact', box.width < 90);
    });
  }

  button(label, icon, callback, className = 'btn btn-secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    button.innerHTML = safeHTML(renderIcon(icon));
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      callback();
    });
    return button;
  }

  open(url) {
    if (this.destroyed || !this.images().includes(url)) return;
    this.previewUrl = url;
    this.render(this.project);
    this.container.querySelector('.character-gallery__close')?.focus({ preventScroll: true });
  }

  images() {
    return (this.showTrash ? this.project?.characterImageTrash : this.project?.covers) || [];
  }

  changeSection() {
    this.showTrash = !this.showTrash;
    this.previewUrl = null;
    this.trashSelection.selected.clear();
    this.trashSelection.selecting = false;
    this.render(this.project);
    this.container.querySelector('.character-gallery__section')?.focus({ preventScroll: true });
  }

  close() {
    if (this.destroyed) return;
    this.returnUrl = this.previewUrl;
    this.previewUrl = null;
    this.render(this.project);
    const tile = [...this.container.querySelectorAll('.character-gallery__tile')].find(
      (button) => button.dataset.imageUrl === this.returnUrl,
    );
    tile?.focus({ preventScroll: true });
  }

  render(project, { descriptionMode = this.descriptionMode || false } = {}) {
    if (this.destroyed) return;
    const focused = this.container.ownerDocument.activeElement;
    const restoreFocus = this.container.contains(focused);
    const focusedLabel = focused?.getAttribute('aria-label');
    const focusedUrl = focused?.dataset.imageUrl;
    this.resizeObserver?.disconnect();
    this.project = project;
    this.descriptionMode = descriptionMode;
    const covers = this.images();
    for (const url of this.dimensions.keys()) if (!covers.includes(url)) this.dimensions.delete(url);
    const selected = this.showTrash ? null : covers[project.currentCoverIndex];
    if (!covers.includes(this.previewUrl)) this.previewUrl = null;
    this.container.replaceChildren();
    this.container.classList.add('character-gallery-panel');
    this.container.classList.toggle('is-empty', !covers.length);
    this.container.classList.toggle('is-viewing', !!this.previewUrl);
    this.container.setAttribute('role', 'region');
    this.container.setAttribute(
      'aria-label',
      this.showTrash ? 'Papelera de imágenes del personaje' : 'Galería de imágenes del personaje',
    );

    const header = document.createElement('header');
    header.className = 'character-gallery__header';
    const heading = document.createElement('h2');
    heading.className = 'character-eyebrow';
    heading.textContent = this.showTrash ? 'PAPELERA DE PERSONAJE' : 'GALERÍA DE PERSONAJE';
    const count = document.createElement('span');
    count.textContent = `${covers.length} ${covers.length === 1 ? 'imagen' : 'imágenes'}`;
    header.append(heading, count);
    this.container.append(header);
    if (this.previewUrl) {
      const image = document.createElement('img');
      image.className = 'book-cover-image character-gallery__full-image';
      image.src = this.previewUrl;
      image.alt = this.showTrash
        ? `${project.name || 'Personaje'} · imagen descartada`
        : `${project.name || 'Personaje'} · imagen ${covers.indexOf(this.previewUrl) + 1}`;
      this.container.append(
        image,
        this.button('Volver a la galería', 'close', () => this.close(), 'character-gallery__close'),
      );
      if (!this.showTrash) {
        const number = document.createElement('span');
        number.className = 'character-gallery__number';
        number.textContent = String(covers.indexOf(this.previewUrl) + 1);
        number.setAttribute('aria-hidden', 'true');
        this.container.append(number);
      }
    } else if (covers.length) {
      if (this.showTrash)
        header.append(
          this.trashSelection.controls(covers, {
            restore: (urls) => this.actions.restoreMany(urls),
            remove: (urls) => this.actions.purge(urls),
            pending: !!project.characterMediaDeletions?.length,
            retry: () => this.actions.retryPurge(),
          }),
        );
      const grid = document.createElement('div');
      grid.className = 'character-gallery__grid';
      for (const [index, url] of covers.entries()) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'character-gallery__tile';
        tile.dataset.imageUrl = url;
        tile.setAttribute(
          'aria-label',
          this.showTrash
            ? 'Abrir imagen descartada'
            : `Abrir imagen ${index + 1}${url === selected ? ', principal' : ''}`,
        );
        if (this.showTrash && this.trashSelection.selecting) {
          tile.setAttribute('aria-label', 'Seleccionar imagen descartada');
          tile.setAttribute('aria-pressed', String(this.trashSelection.selected.has(url)));
          tile.classList.toggle('is-selected', this.trashSelection.selected.has(url));
          if (this.trashSelection.selected.has(url)) tile.append(mediaSelectionMarker());
        }
        const image = document.createElement('img');
        image.alt = this.showTrash
          ? `${project.name || 'Personaje'} · imagen descartada`
          : `${project.name || 'Personaje'} · imagen ${index + 1}`;
        image.decoding = 'async';
        const measure = () => {
          if (this.destroyed || !this.images().includes(url) || !image.naturalWidth || !image.naturalHeight)
            return;
          const ratio = image.naturalWidth / image.naturalHeight;
          if (this.dimensions.get(url) === ratio) return;
          this.dimensions.set(url, ratio);
          this.scheduleLayout();
        };
        image.addEventListener('load', measure, { once: true });
        image.src = url;
        if (image.complete) measure();
        tile.append(image);
        if (!this.showTrash) {
          const number = document.createElement('span');
          number.className = 'character-gallery__number';
          number.textContent = String(index + 1);
          number.setAttribute('aria-hidden', 'true');
          tile.append(number);
        }
        if (url === selected) {
          tile.classList.add('is-primary');
          const badge = document.createElement('span');
          badge.className = 'character-gallery__badge';
          badge.setAttribute('aria-hidden', 'true');
          badge.innerHTML = safeHTML(`${renderIcon('check')}<span>Principal</span>`);
          tile.append(badge);
        }
        tile.addEventListener('click', () =>
          this.showTrash && this.trashSelection.selecting ? this.trashSelection.toggle(url) : this.open(url),
        );
        grid.append(tile);
      }
      this.container.append(grid);
      this.resizeObserver?.observe(grid);
    } else {
      const empty = document.createElement('div');
      empty.className = 'cover-empty';
      empty.innerHTML = safeHTML(
        `<span class="cover-empty__icon" aria-hidden="true">${renderIcon(this.showTrash ? 'trash' : 'character')}</span><h3>${this.showTrash ? 'Papelera vacía' : 'Sin imágenes'}</h3>`,
      );
      this.container.append(empty);
    }

    const footer = document.createElement('footer');
    footer.className = covers.length
      ? 'character-gallery__footer'
      : 'cover-empty__actions character-gallery__footer';
    if (this.showTrash && !covers.length && project.characterMediaDeletions?.length)
      footer.append(
        this.trashSelection.controls([], { pending: true, retry: () => this.actions.retryPurge() }),
      );
    const upload = this.button('Subir', 'upload', () => this.actions.upload());
    const group = document.createElement('div');
    group.className = 'image-generation-actions';
    const generate = this.button(
      descriptionMode ? (project.covers?.length ? 'Generar Otra' : 'Generar foto') : 'Generar',
      descriptionMode ? 'refresh' : 'brush',
      () => this.actions.generate(),
      'btn btn-primary',
    );
    generate.dataset.generationBackend = 'api';
    group.append(generate);
    if (project.covers?.length && this.actions.regenerateProps)
      group.append(this.button('Regenerar props', 'refresh', () => this.actions.regenerateProps()));
    if (!this.previewUrl) {
      if (!this.showTrash) {
        footer.append(upload);
        footer.append(group);
      }
      const trashCount = project.characterImageTrash?.length || 0;
      const section = this.button(
        this.showTrash ? 'Volver a la galería' : `Papelera · ${trashCount}`,
        this.showTrash ? 'chevron-left' : 'trash',
        () => this.changeSection(),
        'btn btn-ghost character-gallery__section',
      );
      if (!this.showTrash) {
        section.lastElementChild.remove();
        section.title = `Papelera · ${trashCount}`;
      }
      footer.append(section);
    }

    if (this.previewUrl) {
      const previewUrl = this.previewUrl;
      const index = covers.indexOf(previewUrl);
      const navigation = document.createElement('div');
      navigation.className = 'character-gallery__navigation';
      if (covers.length > 1)
        navigation.append(
          this.button(
            'Anterior',
            'chevron-left',
            () => this.open(covers[(index - 1 + covers.length) % covers.length]),
            'character-gallery__icon-button',
          ),
        );
      const label = document.createElement('span');
      label.textContent = this.showTrash ? 'Imagen descartada' : `${index + 1} / ${covers.length}`;
      navigation.append(label);
      if (covers.length > 1)
        navigation.append(
          this.button(
            'Siguiente',
            'chevron-right',
            () => this.open(covers[(index + 1) % covers.length]),
            'character-gallery__icon-button',
          ),
        );
      footer.prepend(navigation);
      if (this.showTrash)
        footer.append(this.button('Restaurar imagen', 'refresh', () => this.actions.restore(previewUrl)));
      else if (previewUrl !== selected)
        footer.append(this.button('Usar como principal', 'check', () => this.actions.select(previewUrl)));
      else {
        const badge = document.createElement('span');
        badge.className = 'character-gallery__primary-label';
        badge.textContent = 'Imagen principal';
        footer.append(badge);
      }
      if (!this.showTrash)
        footer.append(
          this.button(
            'Mover a la papelera',
            'trash',
            () => this.actions.delete(previewUrl),
            'character-gallery__icon-button character-gallery__delete',
          ),
        );
    }
    if (!covers.length) this.container.querySelector('.cover-empty').append(footer);
    else this.container.append(footer);
    if (!this.previewUrl && !this.showTrash) this.actions.generation(group);
    this.layout();
    this.scheduleLayout();
    if (restoreFocus) {
      const buttons = [...this.container.querySelectorAll('button')];
      const target =
        buttons.find((button) => focusedUrl && button.dataset.imageUrl === focusedUrl) ||
        buttons.find((button) => focusedLabel && button.getAttribute('aria-label') === focusedLabel) ||
        this.container.querySelector('.character-gallery__close') ||
        buttons.find((button) => focusedUrl && button.dataset.imageUrl === focusedUrl);
      target?.focus({ preventScroll: true });
    }
  }

  destroy() {
    this.trashSelection.destroy();
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (this.frame !== null) this.view.cancelAnimationFrame(this.frame);
    this.dimensions.clear();
    this.container.removeEventListener('keydown', this.keydown);
    this.container.replaceChildren();
    this.project = null;
    this.actions = null;
  }
}
