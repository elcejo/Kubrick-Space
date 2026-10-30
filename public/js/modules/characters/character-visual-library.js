import {
  characterElement as el,
  characterAction as action,
  setCharacterNodeWorking,
} from './character-ui.js';
import {
  CHARACTER_ASSET_GROUPS,
  characterVisualLibraryCurrent,
  characterAssetSections,
  selectedCharacterAssets,
  characterAssetSelectionPending,
  characterAssetSlot,
} from '../../contracts/character-visual-library.js';
import { MediaTrashSelection, mediaSelectionMarker, mediaAssetCode } from '../../media-selection.js';
import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';
import { openCharacterAssetCatalog } from './character-asset-catalog.js';
import { Modal } from '../../ui-components.js';
import { enhanceSelect } from '../../custom-select.js';
import { planCharacterComposition } from '../../contracts/character-composition.js';

export class CharacterVisualLibraryNode {
  constructor(host, view = {}) {
    this.host = host;
    this.category = view.category || 'traits';
    this.selected = view.selected || null;
    this.openSections = new Map();
    this.storageKey = `kai-character-library-sections:${host.projectId}`;
    try {
      const saved = JSON.parse(
        host.node.ownerDocument.defaultView.localStorage.getItem(this.storageKey) || '{}',
      );
      for (const [slot, open] of Object.entries(saved))
        if (/^(traits|clothing|props)\.[a-z][a-z0-9-]{0,47}$/.test(slot) && typeof open === 'boolean') {
          const [category, kind] = slot.split('.');
          const canonical = characterAssetSlot({
            category,
            kind,
            label: kind.replaceAll('-', ' '),
            fieldKeys: [],
          });
          if (!this.openSections.has(canonical) || canonical === slot) this.openSections.set(canonical, open);
        }
    } catch {
      /* Section navigation also works when local storage is unavailable. */
    }
    this.showTrash = !!view.showTrash;
    this.trashSelection = new MediaTrashSelection(() => this.render(), { alwaysSelecting: true });
    this.element = el('section', 'character-visual-library');
    this.element.setAttribute('aria-label', 'Biblioteca visual del personaje');
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.selected) {
        event.preventDefault();
        event.stopPropagation();
        this.closePreview();
      }
    });
    this.render();
    const panel = this.element.querySelector('.character-asset-panel');
    if (panel) panel.scrollTop = view.scrollTop || 0;
  }
  icon(label, icon, callback) {
    const button = action(label, icon, callback, 'btn btn-ghost character-asset-icon');
    for (const node of [...button.childNodes]) if (node.nodeType === 3) node.remove();
    button.title = label;
    return button;
  }
  render() {
    const host = this.host,
      library = host.visualLibrary(),
      trash = (library?.trash || []).filter((item) => !item.unavailable && !item.detached);
    const scrollTop = this.element.querySelector('.character-asset-panel')?.scrollTop || 0;
    const focused = this.element.contains(document.activeElement)
      ? document.activeElement.dataset.assetFocus
      : null;
    this.element.replaceChildren();
    const header = el('header', 'character-workspace__header');
    header.append(el('h2', 'character-eyebrow', this.showTrash ? 'PAPELERA OUTFIT' : 'GALERÍA OUTFIT'));
    const body = el('div', 'character-asset-panel');
    body.id = 'character-assets-panel';
    const footer = el('footer', 'character-asset-footer');
    const items = this.showTrash ? trash : (library?.items || []).filter((item) => !item.unavailable);
    const preview = items.find((item) => item.id === this.selected);
    const valid = library && characterVisualLibraryCurrent(host.project(), host.document);
    if (this.selected && !preview) this.selected = null;
    if (!this.showTrash) {
      const tabs = el('div', 'character-asset-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Rasgos, ropa y props');
      for (const [key, label] of Object.entries(CHARACTER_ASSET_GROUPS)) {
        const button = el('button', 'character-asset-tab', label);
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.id = 'character-assets-tab-' + key;
        button.setAttribute('aria-controls', body.id);
        button.setAttribute('aria-selected', String(this.category === key));
        button.tabIndex = this.category === key ? 0 : -1;
        button.dataset.assetFocus = key;
        button.addEventListener('click', () => {
          this.category = key;
          this.selected = null;
          this.render();
        });
        button.addEventListener('keydown', (event) => {
          const keys = Object.keys(CHARACTER_ASSET_GROUPS),
            index = keys.indexOf(key);
          const next = {
            ArrowRight: (index + 1) % keys.length,
            ArrowLeft: (index + keys.length - 1) % keys.length,
            Home: 0,
            End: keys.length - 1,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          this.category = keys[next];
          this.selected = null;
          this.render();
          this.element.querySelector('[aria-selected="true"]')?.focus();
        });
        tabs.append(button);
      }
      header.append(tabs);
      body.setAttribute('role', 'tabpanel');
      body.setAttribute('aria-labelledby', 'character-assets-tab-' + this.category);
    }
    if (preview) {
      const back = action('Volver a las piezas', 'chevron-left', () => this.closePreview());
      back.dataset.assetFocus = 'back';
      const tools = el('div', 'character-asset-preview-tools');
      tools.append(back);
      if (!this.showTrash) {
        const regenerate = action(
          'Regenerar pieza',
          'refresh',
          () => this.regenerate(preview),
          'btn btn-secondary',
        );
        regenerate.disabled =
          !valid || !preview.image || host.visualLibraryBusy || host.photoGenerating || host.busy;
        tools.append(regenerate);
        tools.append(
          this.icon(
            'Mover pieza a la papelera',
            'trash',
            () => void host.visualAssetAction({ type: 'trash', ids: [preview.id] }),
          ),
        );
      }
      body.append(tools);
      if (preview.image) {
        const image = el('img', 'character-asset-preview');
        image.src = preview.image;
        image.alt = preview.label;
        body.append(image);
      }
      if (!this.showTrash && host.visualLibraryStatusKind === 'progress' && host.visualLibraryStatus) {
        const status = el('p', 'character-asset-status', host.visualLibraryStatus);
        status.setAttribute('role', 'status');
        body.append(status);
      }
      if (this.showTrash)
        footer.append(
          action(
            'Restaurar pieza',
            'refresh',
            () => void host.visualAssetAction({ type: 'restore', ids: [preview.id] }),
          ),
        );
    } else if (this.showTrash) {
      header.append(
        this.trashSelection.controls(
          trash.map((item) => item.id),
          {
            restore: (ids) => host.visualAssetAction({ type: 'restore', ids }),
            remove: (ids) => host.visualAssetAction({ type: 'purge', ids }),
            pending: !!host.project().characterMediaDeletions?.length,
            retry: () => host.visualAssetAction({ type: 'retry-purge' }),
          },
        ),
      );
      const grid = el('div', 'character-asset-grid character-asset-trash-grid');
      for (const item of trash) grid.append(this.tile(item, false));
      body.append(grid);
      if (!trash.length) body.append(el('p', 'character-empty', 'Papelera vacía'));
    } else if (!library) {
      body.append(el('p', 'character-empty', 'Las referencias aparecerán al generar la imagen principal.'));
    } else {
      const selected = new Set(selectedCharacterAssets(library).map((item) => item.id));
      const sections = characterAssetSections(library).filter(
        (section) => section.category === this.category,
      );
      for (const section of sections) {
        const details = el('details', 'character-asset-section');
        details.open = this.openSections.get(section.key) !== false;
        const summary = el('summary', null, section.label);
        const arrow = el('span', 'character-asset-section__arrow');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.innerHTML = safeHTML(renderIcon('chevron-right'));
        summary.prepend(arrow);
        details.append(summary);
        summary.addEventListener('click', () => this.rememberSection(section.key, !details.open));
        details.addEventListener('toggle', () => {
          if (details.isConnected) this.rememberSection(section.key, details.open);
        });
        const grid = el('div', 'character-asset-grid');
        for (const item of section.items.filter((item) => !item.unavailable))
          grid.append(this.tile(item, selected.has(item.id)));
        for (const item of section.items.filter((item) => item.unavailable)) {
          const missing = el('div', 'character-asset-unavailable');
          missing.append(
            el('span', null, 'Pieza retirada de la biblioteca'),
            action('Regenerar ' + section.label, 'refresh', () => this.regenerate(item), 'btn btn-ghost'),
          );
          grid.append(missing);
        }
        const add = this.icon(`Añadir ${section.label} desde biblioteca universal`, 'plus', () => {
          this.catalogCleanup?.();
          this.catalogCleanup = openCharacterAssetCatalog(host, section);
        });
        add.className = 'character-asset-add';
        add.disabled = host.visualLibraryBusy || host.photoGenerating || host.busy;
        grid.append(add);
        if (!section.items.length) grid.prepend(el('p', 'character-empty', 'Sin variantes todavía.'));
        details.append(grid);
        body.append(details);
      }
      if (!sections.length) body.append(el('p', 'character-empty', 'Sin piezas en esta categoría.'));
    }
    if (!preview) {
      const status = el(
        'p',
        'character-asset-status',
        host.visualLibraryStatusKind === 'progress' ? host.visualLibraryStatus || '' : '',
      );
      if (!status.textContent && valid && characterAssetSelectionPending(library)) {
        const plan = planCharacterComposition(library, host.projectId);
        const linked = plan.steps.reduce(
          (count, step) => count + step.items.filter((item) => item.role === 'reapply').length,
          0,
        );
        status.textContent = `${plan.changes.length} cambios y ${linked} piezas vinculadas · ${plan.steps.length} etapas, con revisión visual.`;
      }
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.hidden = !status.textContent;
      footer.append(status);
      const pending = library?.items.filter((item) => !item.image).length || 0;
      if (!this.showTrash && (!valid || pending || library?.format !== 'square-v2')) {
        const generate = action(
          host.visualLibraryBusy
            ? 'Preparando piezas…'
            : valid && pending
              ? 'Reintentar pendientes'
              : valid
                ? 'Actualizar piezas a 1:1'
                : 'Preparar piezas',
          'refresh',
          () => void host.generateVisualLibrary(),
        );
        generate.disabled = host.visualLibraryBusy || !host.project().covers?.length;
        footer.append(generate);
      }
      if (!this.showTrash && valid && characterAssetSelectionPending(library)) {
        const apply = action(
          host.photoGenerating ? 'Aplicando cambios…' : 'Aplicar cambios',
          'check',
          () => void host.applyVisualAssets(),
          'btn btn-primary',
        );
        apply.disabled = host.visualLibraryBusy || host.photoGenerating || host.busy;
        footer.append(apply);
      }
    }
    footer.append(
      action(
        this.showTrash ? 'Volver a las piezas' : 'Abrir papelera',
        this.showTrash ? 'chevron-left' : 'trash',
        () => {
          this.showTrash = !this.showTrash;
          this.selected = null;
          this.trashSelection.selected.clear();
          this.render();
        },
      ),
    );
    this.element.setAttribute('aria-busy', String(!!host.visualLibraryBusy || this.trashSelection.busy));
    this.element.append(header, body, footer);
    if (host.visualLibraryBusy)
      this.element
        .querySelectorAll(
          '.media-trash-controls button, .character-asset-preview-tools .character-asset-icon, .character-asset-unavailable button, [aria-label="Restaurar pieza"]',
        )
        .forEach((button) => {
          button.disabled = true;
        });
    setCharacterNodeWorking(
      this.element,
      !!host.visualLibraryBusy && !host.visualLibraryProgressive,
      host.visualLibraryStatusKind === 'progress'
        ? host.visualLibraryStatus || 'Preparando rasgos, ropa y props…'
        : 'Consultando tareas…',
    );
    if (host.visualLibraryBusy && host.visualLibraryProgressive)
      this.element.setAttribute('aria-busy', 'true');
    if (!preview) body.scrollTop = scrollTop;
    if (focused)
      this.element.querySelector('[data-asset-focus="' + focused + '"]')?.focus({ preventScroll: true });
  }
  rememberSection(slot, open) {
    this.openSections.set(slot, open);
    try {
      this.host.node.ownerDocument.defaultView.localStorage.setItem(
        this.storageKey,
        JSON.stringify(Object.fromEntries(this.openSections)),
      );
    } catch {
      /* Keep the in-memory state. */
    }
  }
  regenerate(item) {
    const host = this.host;
    if (host.visualLibraryBusy || host.photoGenerating || host.busy) return;
    const library = host.visualLibrary();
    const original = host.document.creation.mode === 'image' ? host.document.creation.referenceImage : '';
    const references = [{ image: library.sourceImage, label: 'Retrato actual' }];
    if (original && original !== library.sourceImage)
      references.push({ image: original, label: 'Fotografía original' });
    const root = el('div', 'character-asset-regenerate');
    root.append(
      el(
        'p',
        'character-empty',
        'Se regenerará solo esta pieza. La anterior irá a la papelera; el personaje y las demás piezas se conservarán.',
      ),
    );
    const label = el('label', null, 'Referencia para la extracción');
    const select = el('select', 'select');
    select.setAttribute('aria-label', 'Referencia para regenerar pieza');
    for (const reference of references) {
      const option = el('option', null, reference.label);
      option.value = reference.image;
      select.append(option);
    }
    label.append(select);
    const control = enhanceSelect(select, { searchable: false });
    const preview = el('img', 'character-photo-dialog__preview');
    preview.src = references[0].image;
    preview.alt = 'Referencia seleccionada para extraer la pieza';
    select.addEventListener('change', () => {
      preview.src = select.value;
    });
    const footer = el('div', 'character-photo-dialog__actions');
    const cancel = action('Cancelar', 'close', () => Modal.hide());
    const generate = action(
      'Regenerar pieza',
      'refresh',
      () => {
        const referenceImage = select.value;
        Modal.hide();
        void host.visualAssetAction({ type: 'regenerate', id: item.id, referenceImage });
      },
      'btn btn-primary',
    );
    footer.append(cancel, generate);
    root.append(label, preview, footer);
    this.regenerateCleanup?.();
    const close = () => {
      if (root.isConnected) Modal.hide();
    };
    this.regenerateCleanup = close;
    Modal.show({
      title: 'Regenerar pieza',
      content: root,
      initialFocus: control.trigger,
      onDismiss: () => control.destroy(),
    });
  }
  tile(item, selected) {
    const root = el('div', 'character-asset-tile');
    root.dataset.assetId = item.id;
    const picked = this.showTrash ? this.trashSelection.selected.has(item.id) : selected;
    root.classList.toggle('is-selected', picked);
    const button = el('button', 'character-asset-choice');
    button.type = 'button';
    button.dataset.assetFocus = item.id;
    button.setAttribute(
      'aria-label',
      this.showTrash ? 'Seleccionar ' + item.label + ' de papelera' : 'Seleccionar ' + item.label,
    );
    button.setAttribute('aria-pressed', String(picked));
    button.disabled =
      (this.showTrash && this.trashSelection.busy) ||
      (!this.showTrash && (!item.image || this.host.visualLibraryBusy || this.host.photoGenerating));
    if (item.image) {
      const image = el('img');
      image.src = item.image;
      image.alt = '';
      image.decoding = 'async';
      button.append(image);
    } else {
      const placeholder = el('span', 'character-asset-placeholder');
      placeholder.innerHTML = safeHTML(renderIcon('image'));
      button.append(placeholder);
    }
    button.addEventListener('click', () => {
      if (this.showTrash) this.trashSelection.toggle(item.id);
      else void this.host.visualAssetAction({ type: 'select', ids: [item.id] });
    });
    root.append(button);
    if (picked) root.append(mediaSelectionMarker());
    if (item.image) {
      const preview = this.icon('Ampliar ' + item.label, 'eye', () => this.open(item.id));
      preview.dataset.assetFocus = 'preview-' + item.id;
      preview.disabled = this.showTrash && this.trashSelection.busy;
      preview.classList.add('character-asset-preview-action');
      root.append(preview);
    }
    if (!this.showTrash && item.image) {
      const disabled = this.host.visualLibraryBusy || this.host.photoGenerating || this.host.busy;
      const remove = this.icon(
        'Quitar ' + item.label + ' del personaje',
        'close',
        () => void this.host.visualAssetAction({ type: 'detach', ids: [item.id] }),
      );
      remove.classList.add('character-asset-detach');
      remove.disabled = disabled;
      const trash = this.icon(
        'Mover ' + item.label + ' a papelera Outfit',
        'trash',
        () => void this.host.visualAssetAction({ type: 'trash', ids: [item.id] }),
      );
      trash.classList.add('character-asset-trash-action');
      trash.disabled = disabled;
      root.append(remove, trash);
    }
    const card = el('div', 'character-asset-card');
    card.append(
      root,
      mediaAssetCode(item.code, {
        onRename: this.host.visualLibraryBusy
          ? undefined
          : (code, expectedCode) =>
              this.host.visualAssetAction({
                type: 'rename-code',
                id: item.id,
                image: item.image,
                code,
                expectedCode,
              }),
      }),
    );
    return card;
  }
  open(id) {
    const item = [
      ...(this.host.visualLibrary()?.items || []),
      ...(this.host.visualLibrary()?.trash || []),
    ].find((entry) => entry.id === id);
    if (!item) return;
    this.previewScrollTop = this.element.querySelector('.character-asset-panel')?.scrollTop || 0;
    this.showTrash = (this.host.visualLibrary()?.trash || []).some((entry) => entry.id === id);
    this.category = item.category;
    this.selected = id;
    this.render();
    this.element.querySelector('[data-asset-focus="back"]')?.focus({ preventScroll: true });
  }
  closePreview() {
    const id = this.selected;
    this.selected = null;
    this.render();
    this.element.querySelector('.character-asset-panel').scrollTop = this.previewScrollTop || 0;
    this.element.querySelector('[data-asset-focus="preview-' + id + '"]')?.focus({ preventScroll: true });
  }
  destroy() {
    this.regenerateCleanup?.();
    this.catalogCleanup?.();
    this.trashSelection.destroy();
    this.element.remove();
  }
}

/** Design references share the inventory; no duplicated outfit data or edited descriptions. */
let designTooltipSequence = 0;
export function characterDesignAssets(library, open, cleanups = []) {
  const section = el('section', 'character-design-assets');
  section.setAttribute('aria-label', 'Referencias visuales del diseño');
  for (const [category, label] of Object.entries(CHARACTER_ASSET_GROUPS)) {
    const items = selectedCharacterAssets(library).filter((item) => item.category === category);
    if (!items.length) continue;
    section.append(el('h3', null, label));
    const grid = el('div', 'character-design-assets__grid');
    section.append(grid);
    for (const item of items) {
      const card = el('article', 'character-design-asset');
      const button = el('button', 'character-design-asset__image');
      button.type = 'button';
      button.setAttribute('aria-label', `Ver ${item.label}`);
      if (item.image) {
        const image = el('img');
        image.src = item.image;
        image.alt = '';
        image.decoding = 'async';
        button.append(image);
      } else button.append(el('span', null, item.error ? 'Pendiente' : 'Preparando…'));
      button.addEventListener('click', () => open(item.id));
      let tooltip;
      const hide = () => {
        tooltip?.remove();
        tooltip = null;
        button.removeAttribute('aria-describedby');
        window.removeEventListener('scroll', hide, true);
        window.removeEventListener('resize', hide);
      };
      const show = () => {
        hide();
        tooltip = el('div', 'character-design-tooltip liquid-tooltip');
        tooltip.id = 'character-design-tooltip-' + ++designTooltipSequence;
        tooltip.setAttribute('role', 'tooltip');
        tooltip.append(
          el('strong', null, item.label + (item.code ? ' · #' + item.code : '')),
          el('p', null, item.description),
        );
        document.body.append(tooltip);
        button.setAttribute('aria-describedby', tooltip.id);
        const rect = button.getBoundingClientRect(),
          size = tooltip.getBoundingClientRect();
        tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - size.width - 8)) + 'px';
        tooltip.style.top =
          (rect.bottom + size.height + 16 < window.innerHeight
            ? rect.bottom + 8
            : Math.max(8, rect.top - size.height - 8)) + 'px';
        window.addEventListener('scroll', hide, true);
        window.addEventListener('resize', hide);
      };
      button.addEventListener('pointerenter', show);
      button.addEventListener('pointerleave', hide);
      button.addEventListener('focus', show);
      button.addEventListener('blur', hide);
      button.addEventListener('click', hide);
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          hide();
          event.stopPropagation();
        }
      });
      cleanups.push(hide);
      card.append(button);
      grid.append(card);
    }
  }
  return section;
}
