import { renderIcon } from './icons.js';
import { safeHTML } from './safe-html.js';
/** Preserve provider groups in both native selects and the searchable presentation. */
export function appendModelGroups(select, models, { image = false } = {}) {
  const groups = new Map();
  for (const model of models) {
    const provider = model.provider || 'openrouter';
    if (!groups.has(provider)) {
      const group = select.ownerDocument.createElement('optgroup');
      group.label =
        {
          openrouter: 'OpenRouter',
          replicate: 'Replicate',
          openai: 'OpenAI',
          gemini: 'Google Gemini',
          local: 'Local',
        }[provider] || provider;
      groups.set(provider, group);
      select.append(group);
    }
    const option = select.ownerDocument.createElement('option');
    option.modelData = model;
    option.value = image ? `${provider}:${model.model}` : model.id;
    option.textContent = image ? model.label : model.name || model.id;
    groups.get(provider).append(option);
  }
}
/** Themed, searchable selection UI. The hidden select remains the form/data contract. */
const controls = new WeakMap();
let sequence = 0;

export function enhanceSelect(
  select,
  { searchable = true, placeholder = 'Selecciona una opción', allowEmpty = false } = {},
) {
  if (controls.has(select)) return controls.get(select);
  const doc = select.ownerDocument;
  const win = doc.defaultView;
  const original = { hidden: select.hidden, tabIndex: select.tabIndex };
  const root = doc.createElement('div');
  root.className = 'kai-select';
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'kai-select__trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (select.dataset.control) trigger.dataset.control = select.dataset.control;
  const name = doc.createElement('span');
  name.className = 'kai-select__name';
  const arrow = doc.createElement('span');
  arrow.className = 'kai-select__arrow';
  arrow.innerHTML = safeHTML(renderIcon('chevron-down'));
  arrow.setAttribute('aria-hidden', 'true');
  trigger.append(name, arrow);
  const menu = doc.createElement('div');
  menu.className = 'kai-select__menu';
  menu.hidden = true;
  const topLayer = typeof menu.showPopover === 'function';
  if (topLayer) menu.setAttribute('popover', 'manual');
  const search = doc.createElement('input');
  search.type = 'search';
  search.className = 'kai-select__search';
  search.placeholder = 'Buscar…';
  search.autocomplete = 'off';
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'false');
  if (searchable) menu.append(search);
  const list = doc.createElement('div');
  list.className = 'kai-select__list';
  list.id = `kai-select-list-${++sequence}`;
  list.setAttribute('role', 'listbox');
  menu.append(list);
  trigger.setAttribute('aria-controls', list.id);
  search.setAttribute('aria-controls', list.id);
  select.before(root);
  root.append(select, trigger, menu);
  select.hidden = true;
  select.tabIndex = -1;
  let opened = false,
    destroyed = false,
    active = -1,
    filtered = [];
  const tokens = (value) =>
    String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const position = () => {
    if (!opened || !topLayer) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = win.visualViewport;
    const left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0;
    const width = viewport?.width || win.innerWidth,
      height = viewport?.height || win.innerHeight;
    const menuWidth = Math.min(Math.max(rect.width, 220), width - 24);
    const below = top + height - rect.bottom - 12,
      above = rect.top - top - 12;
    const upwards = below < 180 && above > below;
    const maxHeight = Math.max(80, Math.min(320, upwards ? above : below));
    menu.style.width = `${menuWidth}px`;
    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - menuWidth - 12))}px`;
    menu.style.top = `${upwards ? Math.max(top + 12, rect.top - Math.min(menu.scrollHeight, maxHeight) - 6) : rect.bottom + 6}px`;
  };
  const highlight = () => {
    const options = [...list.querySelectorAll('[role="option"]')];
    options.forEach((option, index) => option.classList.toggle('is-active', index === active));
    const id = options[active]?.id;
    for (const field of [trigger, search]) {
      if (opened && id) field.setAttribute('aria-activedescendant', id);
      else field.removeAttribute('aria-activedescendant');
    }
    options[active]?.scrollIntoView?.({ block: 'nearest' });
  };
  const close = ({ restoreFocus = false } = {}) => {
    if (!opened) return;
    opened = false;
    if (topLayer) menu.hidePopover();
    menu.hidden = true;
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-expanded', 'false');
    win.removeEventListener('resize', position);
    win.removeEventListener('scroll', position, true);
    win.visualViewport?.removeEventListener('resize', position);
    win.visualViewport?.removeEventListener('scroll', position);
    highlight();
    if (restoreFocus && trigger.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
  };
  const choose = (option) => {
    if (!option || option.disabled || option.hidden || !select.contains(option) || destroyed) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close({ restoreFocus: true });
    refresh();
    if (changed) {
      select.dispatchEvent(new win.Event('input', { bubbles: true }));
      select.dispatchEvent(new win.Event('change', { bubbles: true }));
    }
  };
  const render = () => {
    const selected = filtered[active]?.value;
    const query = tokens(searchable ? search.value : '');
    filtered = [...select.options].filter(
      (option) =>
        (allowEmpty || option.value) &&
        !option.hidden &&
        !option.disabled &&
        query.every((fragment) => tokens(option.textContent).some((word) => word.startsWith(fragment))),
    );
    const previous = filtered.findIndex((option) => option.value === selected);
    active =
      previous >= 0
        ? previous
        : Math.max(
            0,
            filtered.findIndex((option) => option.value === select.value),
          );
    list.replaceChildren();
    let lastGroup;
    filtered.forEach((option, index) => {
      const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement : null;
      if (group && group !== lastGroup) {
        const heading = doc.createElement('div');
        heading.className = 'settings-model-group';
        heading.textContent = group.label;
        heading.setAttribute('role', 'presentation');
        list.append(heading);
      }
      lastGroup = group;
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'kai-select__option';
      row.id = `${list.id}-option-${index}`;
      row.tabIndex = -1;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === select.value));
      row.textContent = option.textContent;
      row.title = option.textContent;
      row.addEventListener('pointermove', () => {
        active = index;
        highlight();
      });
      // Keep focus on the combobox until selection completes. A top-layer
      // option can sit outside a flipped card's painted bounds; moving focus
      // on mousedown would close that card before the subsequent click.
      row.addEventListener('mousedown', (event) => event.preventDefault());
      row.addEventListener('click', (event) => {
        event.preventDefault();
        choose(option);
      });
      list.append(row);
    });
    if (!filtered.length) {
      const empty = doc.createElement('p');
      empty.className = 'kai-select__empty';
      empty.setAttribute('role', 'status');
      empty.textContent = 'Sin coincidencias';
      list.append(empty);
    }
    highlight();
    position();
  };
  function refresh() {
    if (destroyed) return;
    const selected = select.selectedOptions[0];
    name.textContent = selected?.textContent || placeholder;
    trigger.title = selected?.textContent || placeholder;
    const caption = select.labels?.[0]?.cloneNode(true);
    caption?.querySelectorAll('select, .kai-select, button, input').forEach((field) => field.remove());
    const label = select.getAttribute('aria-label') || caption?.textContent.trim() || placeholder;
    trigger.setAttribute('aria-label', label);
    search.setAttribute('aria-label', `Buscar: ${label}`);
    list.setAttribute('aria-label', label);
    trigger.disabled = select.disabled;
    if (select.disabled) close();
    render();
  }
  const open = () => {
    if (destroyed || select.disabled || opened) return;
    opened = true;
    search.value = '';
    menu.hidden = false;
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-expanded', 'true');
    if (topLayer) menu.showPopover();
    refresh();
    win.addEventListener('resize', position);
    win.addEventListener('scroll', position, true);
    win.visualViewport?.addEventListener('resize', position);
    win.visualViewport?.addEventListener('scroll', position);
    (searchable ? search : trigger).focus({ preventScroll: true });
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: true });
    } else if (event.key === 'Tab' && opened) close({ restoreFocus: true });
    else if (
      ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
      (opened || event.target === trigger)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const wasOpen = opened;
      open();
      if (wasOpen || ['Home', 'End'].includes(event.key))
        active =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? filtered.length - 1
              : Math.max(0, Math.min(filtered.length - 1, active + (event.key === 'ArrowUp' ? -1 : 1)));
      highlight();
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target === trigger)) {
      event.preventDefault();
      event.stopPropagation();
      if (opened) choose(filtered[active]);
      else open();
    }
  };
  const onTrigger = () => (opened ? close() : open());
  const onSearch = () => {
    active = -1;
    render();
  };
  const onOutside = (event) => {
    if (!root.contains(event.target)) close();
  };
  const onFocusOut = (event) => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) close();
  };
  trigger.addEventListener('click', onTrigger);
  search.addEventListener('input', onSearch);
  root.addEventListener('keydown', onKey);
  root.addEventListener('focusout', onFocusOut);
  select.addEventListener('change', refresh);
  doc.addEventListener('pointerdown', onOutside);
  const observer = new win.MutationObserver(refresh);
  observer.observe(select, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'selected', 'value', 'label', 'aria-label'],
  });
  const control = {
    root,
    trigger,
    menu,
    search,
    refresh,
    open,
    close,
    reposition: position,
    destroy({ restore = true } = {}) {
      if (destroyed) return;
      close();
      destroyed = true;
      observer.disconnect();
      doc.removeEventListener('pointerdown', onOutside);
      select.removeEventListener('change', refresh);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('focusout', onFocusOut);
      trigger.removeEventListener('click', onTrigger);
      search.removeEventListener('input', onSearch);
      if (restore) {
        select.hidden = original.hidden;
        select.tabIndex = original.tabIndex;
        root.replaceWith(select);
      } else root.remove();
      controls.delete(select);
    },
  };
  controls.set(select, control);
  refresh();
  return control;
}

function formatModelPrice(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const perMillion = amount * 1_000_000;
  if (perMillion === 0) return 'gratis';
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`;
  return `$${perMillion.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
function formatIntelligenceScore(value) {
  if (value == null || value === '') return '—';
  const score = Number(value);
  return Number.isFinite(score) ? score.toFixed(1).replace(/\.0$/, '') : '—';
}

export function createModelPicker(
  prompt,
  models,
  currentModel,
  { onChange = null, benchmarkAvailable = false, image = false, grouped = false } = {},
) {
  const picker = document.createElement('div');
  picker.className = 'settings-model-picker';
  picker.dataset.modelPicker = prompt.id;
  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'hidden';
  hiddenInput.dataset.llmModel = prompt.id;
  hiddenInput.value = currentModel || '';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'settings-model-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute(
    'aria-label',
    `Seleccionar modelo ${image ? 'de imagen' : 'de texto'} para ${prompt.label}`,
  );
  const triggerName = document.createElement('span');
  triggerName.className = 'settings-model-trigger-name';
  const triggerMeta = document.createElement('span');
  triggerMeta.className = 'settings-model-trigger-meta';
  const triggerArrow = document.createElement('span');
  triggerArrow.className = 'settings-model-trigger-arrow';
  triggerArrow.setAttribute('aria-hidden', 'true');
  triggerArrow.innerHTML = safeHTML(renderIcon('chevron-down'));
  trigger.append(triggerName, triggerMeta, triggerArrow);
  const popover = document.createElement('div');
  popover.className = 'settings-model-popover';
  popover.hidden = true;
  const toolbar = document.createElement('div');
  toolbar.className = 'settings-model-toolbar';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'settings-model-search';
  search.placeholder = 'Buscar modelo…';
  search.setAttribute('aria-label', `Buscar modelo para ${prompt.label}`);
  const sort = document.createElement('div');
  sort.className = 'settings-model-sort';
  sort.setAttribute('role', 'group');
  sort.setAttribute('aria-label', 'Ordenar modelos');
  const sortButtons = new Map();
  for (const [key, text] of [
    ['name', 'A–Z'],
    ['price', 'Precio'],
    ['ranking', 'Ranking'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-model-sort-button';
    button.dataset.modelSort = key;
    button.textContent = text;
    sortButtons.set(key, button);
    sort.append(button);
  }
  const rankingFilter = document.createElement('label');
  rankingFilter.className = 'settings-model-ranking-filter';
  const rankingCheckbox = document.createElement('input');
  rankingCheckbox.type = 'checkbox';
  rankingCheckbox.dataset.modelRankingFilter = 'true';
  rankingCheckbox.disabled = !benchmarkAvailable;
  rankingCheckbox.title = rankingCheckbox.disabled
    ? 'Configura una clave válida de Artificial Analysis para activar este filtro.'
    : 'Mostrar solo modelos presentes en el ranking de Artificial Analysis';
  const rankingLabel = document.createElement('span');
  rankingLabel.textContent = 'Ranking';
  rankingFilter.append(rankingCheckbox, rankingLabel);
  sort.append(rankingFilter);
  toolbar.append(search, sort);
  const list = document.createElement('div');
  list.className = 'settings-model-list';
  list.setAttribute('role', 'listbox');
  list.tabIndex = 0;
  list.id = `settings-model-list-${++sequence}`;
  list.setAttribute('aria-label', `Modelos para ${prompt.label}`);
  trigger.setAttribute('aria-controls', list.id);
  let activeId = currentModel || '';
  const activate = (index) => {
    const options = [...list.querySelectorAll('[role=option]')];
    if (!options.length) {
      activeId = '';
      list.removeAttribute('aria-activedescendant');
      return;
    }
    const active = options[Math.max(0, Math.min(options.length - 1, index))];
    activeId = active.dataset.modelId;
    for (const option of options) option.classList.toggle('is-active', option === active);
    list.setAttribute('aria-activedescendant', active.id);
    if (document.activeElement === list) active.scrollIntoView?.({ block: 'nearest' });
  };
  popover.append(toolbar, list);
  if (benchmarkAvailable) {
    const attribution = document.createElement('p');
    attribution.className = 'settings-model-attribution';
    const link = document.createElement('a');
    link.href = 'https://artificialanalysis.ai/';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = image
      ? 'Artificial Analysis · Elo de imagen'
      : 'Artificial Analysis · Intelligence Index';
    attribution.append(link);
    popover.append(attribution);
  }
  picker.append(hiddenInput, trigger, popover);

  const isBatchModel = (model) =>
    [model?.id, model?.name, model?.canonicalSlug].some(
      (value) => typeof value === 'string' && /(?:^|[^a-z0-9])batch(?:$|[^a-z0-9])/i.test(value),
    );
  const catalogModels = Array.isArray(models)
    ? models.filter((model) => !isBatchModel(model)).map((model) => ({ ...model }))
    : [];
  if (
    currentModel &&
    !isBatchModel({ id: currentModel }) &&
    !catalogModels.some((model) => model.id === currentModel)
  ) {
    catalogModels.push({
      id: currentModel,
      name: currentModel,
      pricing: {},
      description: 'Modelo guardado en la configuración actual.',
    });
  }
  let sortMode = 'name';
  let priceDirection = 'asc';
  let rankingDirection = 'asc';
  let rendered = false;
  const priceValue = (model) => {
    if (image) return model.price == null ? Infinity : model.price;
    const input = model.pricing?.prompt == null ? NaN : Number(model.pricing.prompt);
    const output = model.pricing?.completion == null ? NaN : Number(model.pricing.completion);
    const values = [input, output].filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : Infinity;
  };
  const updateTrigger = () => {
    const selected = catalogModels.find((model) => model.id === hiddenInput.value);
    triggerName.textContent = selected?.name || hiddenInput.value || 'Selecciona un modelo';
    triggerMeta.textContent = selected?.id && selected.id !== selected.name ? selected.id : '';
    trigger.title = selected?.description || selected?.id || '';
  };
  const normalizeSearchText = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase();
  const searchTokens = (value) =>
    normalizeSearchText(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const matchesSearch = (query, model) => {
    const queryTokens = searchTokens(query);
    const modelTokens = searchTokens([model.name, model.id].filter(Boolean).join(' '));
    // Every typed fragment is an AND condition. It may match any model
    // word, either completely or as the prefix currently being typed.
    return queryTokens.every((queryToken) =>
      modelTokens.some((modelToken) => modelToken === queryToken || modelToken.startsWith(queryToken)),
    );
  };
  const renderOptions = () => {
    rendered = true;
    // Search only the visible identity fields. A hidden provider
    // description can mention unrelated capabilities and must not match.
    const filtered = catalogModels.filter((model) => {
      if (!matchesSearch(search.value, model)) return false;
      if (!rankingCheckbox.checked) return true;
      const score = model.artificialAnalysis;
      return Boolean(
        score &&
        ((score.rank != null && Number.isFinite(Number(score.rank))) ||
          (score.intelligenceScore != null && Number.isFinite(Number(score.intelligenceScore)))),
      );
    });
    filtered.sort((a, b) => {
      if (sortMode === 'price') {
        const pa = priceValue(a),
          pb = priceValue(b);
        if (Number.isFinite(pa) !== Number.isFinite(pb)) return Number.isFinite(pa) ? -1 : 1;
        const difference = pa - pb;
        if (difference) return priceDirection === 'asc' ? difference : -difference;
      }
      if (sortMode === 'ranking') {
        const rankA = a.artificialAnalysis?.rank == null ? NaN : Number(a.artificialAnalysis.rank);
        const rankB = b.artificialAnalysis?.rank == null ? NaN : Number(b.artificialAnalysis.rank);
        const hasRankA = Number.isFinite(rankA);
        const hasRankB = Number.isFinite(rankB);
        // Models without a benchmark position stay at the end in either direction.
        if (hasRankA !== hasRankB) return hasRankA ? -1 : 1;
        if (hasRankA && rankA !== rankB) return rankingDirection === 'asc' ? rankA - rankB : rankB - rankA;
      }
      return String(a.name || a.id).localeCompare(String(b.name || b.id), 'en', { sensitivity: 'base' });
    });
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'settings-model-empty';
      empty.textContent = rankingCheckbox.checked
        ? 'No hay modelos con datos en el ranking.'
        : 'No hay modelos que coincidan con la búsqueda.';
      list.append(empty);
    }
    let previousGroup;
    if (grouped)
      filtered.sort((a, b) => (a.provider || 'openrouter').localeCompare(b.provider || 'openrouter'));
    for (const model of filtered) {
      const provider = model.provider || 'openrouter';
      if (grouped && provider !== previousGroup) {
        const heading = document.createElement('div');
        heading.className = 'settings-model-group';
        heading.textContent =
          {
            openrouter: 'OpenRouter',
            replicate: 'Replicate',
            openai: 'OpenAI',
            gemini: 'Google Gemini',
            local: 'Local',
          }[provider] || provider;
        list.append(heading);
        previousGroup = provider;
      }
      const option = document.createElement('div');
      option.className = 'settings-model-option';
      if (model.id === hiddenInput.value) option.classList.add('is-selected');
      option.dataset.modelId = model.id;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(model.id === hiddenInput.value));
      option.tabIndex = -1;
      option.id = `${list.id}-option-${list.children.length}`;
      const info = document.createElement('span');
      info.className = 'settings-model-option-info';
      const identity = document.createElement('span');
      identity.className = 'settings-model-option-identity';
      const benchmark = model.artificialAnalysis;
      if (
        (!image || rankingCheckbox.checked) &&
        benchmark &&
        (benchmark.rank !== null || benchmark.intelligenceScore !== null)
      ) {
        const badge = document.createElement('span');
        badge.className = 'settings-model-benchmark';
        const rank = benchmark.rank === null || benchmark.rank === undefined ? '—' : `#${benchmark.rank}`;
        const score = formatIntelligenceScore(benchmark.intelligenceScore);
        badge.textContent = `${rank} · ${score}`;
        badge.title = benchmark.metric || 'Artificial Analysis Intelligence Index';
        badge.setAttribute('aria-label', `Artificial Analysis: puesto ${rank}, puntuación ${score}`);
        identity.append(badge);
      }
      const name = document.createElement('strong');
      name.textContent = model.name || model.id;
      identity.append(name);
      const id = document.createElement('small');
      id.textContent = model.id;
      info.append(identity, id);
      const pricing = document.createElement('span');
      pricing.className = 'settings-model-option-pricing';
      const inputPrice = document.createElement('span');
      inputPrice.textContent =
        model.provider === 'local' ? 'En este equipo' : `Entrada ${formatModelPrice(model.pricing?.prompt)}`;
      const outputPrice = document.createElement('span');
      outputPrice.textContent =
        model.provider === 'local' ? 'Sin API' : `Salida ${formatModelPrice(model.pricing?.completion)}`;
      if (image) {
        inputPrice.textContent = model.label?.split(' · ').slice(1).join(' · ') || 'Costo variable / imagen';
        pricing.append(inputPrice);
      } else {
        pricing.append(inputPrice, outputPrice);
        pricing.title = 'USD por millón de tokens';
      }
      option.append(info, pricing);
      const select = () => {
        hiddenInput.value = model.id;
        if (typeof onChange === 'function') onChange(model);
        updateTrigger();
        renderOptions();
        hiddenInput.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
        closePicker(true);
      };
      option.addEventListener('click', select);
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
      list.append(option);
    }
    activate(
      [...list.querySelectorAll('[role=option]')].findIndex((option) => option.dataset.modelId === activeId),
    );
  };
  const positionPopover = () => {
    if (!picker.classList.contains('is-open') || !popover.showPopover) return;
    const rect = trigger.getBoundingClientRect();
    const view = document.defaultView;
    const width = Math.min(Math.max(rect.width, 390), view.innerWidth - 24);
    const below = view.innerHeight - rect.bottom - 18;
    const above = rect.top - 18;
    const placeAbove = below < Math.min(360, above);
    const height = Math.max(0, Math.min(360, placeAbove ? above : below));
    popover.style.left = `${Math.max(12, Math.min(rect.left, view.innerWidth - width - 12))}px`;
    popover.style.top = `${placeAbove ? Math.max(12, rect.top - height - 6) : rect.bottom + 6}px`;
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${height}px`;
  };
  const closePicker = (restoreFocus = false) => {
    picker.classList.remove('is-open');
    if (popover.hidePopover && popover.matches(':popover-open')) popover.hidePopover();
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.defaultView.removeEventListener('resize', positionPopover);
    document.defaultView.removeEventListener('scroll', positionPopover, true);
    picker.closest('dialog')?.removeEventListener('scroll', positionPopover, true);
    if (restoreFocus && trigger.isConnected) trigger.focus();
  };
  picker.closeModelPicker = closePicker;
  const setSelectedModel = (value, { silent = false } = {}) => {
    hiddenInput.value = value || '';
    if (!silent && typeof onChange === 'function')
      onChange(catalogModels.find((model) => model.id === hiddenInput.value) || null);
    updateTrigger();
    if (rendered) renderOptions();
    if (!silent) hiddenInput.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  };
  const openPicker = (focusList = false, fromEnd = false) => {
    if (trigger.disabled) return;
    document
      .querySelectorAll('.settings-model-picker.is-open')
      .forEach((other) => other.closeModelPicker?.());
    picker.classList.add('is-open');
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (popover.showPopover) {
      popover.setAttribute('popover', 'manual');
      popover.showPopover();
      positionPopover();
      document.defaultView.addEventListener('resize', positionPopover);
      document.defaultView.addEventListener('scroll', positionPopover, true);
      picker.closest('dialog')?.addEventListener('scroll', positionPopover, true);
    }
    renderOptions();
    if (focusList) {
      list.focus();
      activate(fromEnd ? list.querySelectorAll('[role=option]').length - 1 : 0);
    } else search.focus();
  };
  trigger.addEventListener('click', () => {
    if (picker.classList.contains('is-open')) closePicker(true);
    else openPicker();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openPicker(true, event.key === 'ArrowUp');
    }
  });
  list.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    const options = [...list.querySelectorAll('[role=option]')];
    const index = options.findIndex((option) => option.dataset.modelId === activeId);
    if (event.key === 'Enter' || event.key === ' ') options[index]?.click();
    else
      activate(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : index + (event.key === 'ArrowDown' ? 1 : -1),
      );
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      list.focus();
      activate(event.key === 'ArrowDown' ? 0 : list.querySelectorAll('[role=option]').length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      list.querySelector('.is-active')?.click();
    }
  });
  search.addEventListener('input', renderOptions);
  const updateSortButtons = () => {
    sortButtons.forEach((button, key) => {
      button.classList.toggle('is-active', key === sortMode);
      if (key === 'price' || key === 'ranking') {
        const direction = key === 'price' ? priceDirection : rankingDirection;
        const label = key === 'price' ? 'Precio' : 'Ranking';
        button.innerHTML = safeHTML(
          `${label} ${renderIcon(direction === 'asc' ? 'chevron-up' : 'chevron-down', 14)}`,
        );
        button.setAttribute('aria-label', `${label}: ${direction === 'asc' ? 'ascendente' : 'descendente'}`);
      }
    });
  };
  sortButtons.get('name').addEventListener('click', () => {
    sortMode = 'name';
    updateSortButtons();
    renderOptions();
  });
  sortButtons.get('price').addEventListener('click', () => {
    if (sortMode === 'price') priceDirection = priceDirection === 'asc' ? 'desc' : 'asc';
    else {
      sortMode = 'price';
      priceDirection = 'asc';
    }
    updateSortButtons();
    renderOptions();
  });
  sortButtons.get('ranking').addEventListener('click', () => {
    if (!benchmarkAvailable) return;
    if (sortMode === 'ranking') rankingDirection = rankingDirection === 'asc' ? 'desc' : 'asc';
    else {
      sortMode = 'ranking';
      rankingDirection = 'asc';
    }
    updateSortButtons();
    renderOptions();
  });
  rankingCheckbox.addEventListener('change', renderOptions);
  sortButtons.get('ranking').disabled = !benchmarkAvailable;
  sortButtons.get('ranking').title = benchmarkAvailable
    ? 'Ordenar por puesto en Artificial Analysis'
    : 'Configura una clave válida de Artificial Analysis para activar este orden.';
  updateSortButtons();
  updateTrigger();
  const outside = (event) => {
    if (!picker.contains(event.target)) closePicker();
  };
  const escape = (event) => {
    if (event.key === 'Escape' && picker.classList.contains('is-open')) {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
    }
  };
  document.addEventListener('pointerdown', outside);
  picker.addEventListener('keydown', escape);
  picker.destroyModelPicker = () => {
    closePicker();
    document.removeEventListener('pointerdown', outside);
    picker.removeEventListener('keydown', escape);
  };
  return {
    element: picker,
    trigger,
    setSelectedModel,
    destroy() {
      closePicker();
      document.removeEventListener('pointerdown', outside);
      picker.removeEventListener('keydown', escape);
      picker.remove();
    },
  };
}

/** Rich catalog UI backed by the original select, shared by project and character controls. */
export function enhanceModelSelect(select, { image = false } = {}) {
  const root = document.createElement('div');
  root.className = 'kai-select kai-model-select';
  select.before(root);
  root.append(select);
  const original = { hidden: select.hidden, tabIndex: select.tabIndex };
  select.hidden = true;
  select.tabIndex = -1;
  let picker,
    previousOptions = [];
  function refresh() {
    const options = [...select.options].filter((option) => option.value && !option.disabled);
    if (
      !picker ||
      options.length !== previousOptions.length ||
      options.some((option, i) => option !== previousOptions[i])
    ) {
      picker?.destroy();
      previousOptions = options;
      const models = options.map((option) => ({
        ...option.modelData,
        id: option.value,
        name: option.modelData?.name || (image ? option.textContent.split(' · ')[0] : option.textContent),
      }));
      picker = createModelPicker(
        {
          id: select.getAttribute('aria-label') || 'model',
          label: select.getAttribute('aria-label') || 'Modelo',
        },
        models,
        select.value,
        {
          image,
          grouped: true,
          benchmarkAvailable: models.some((model) => model.artificialAnalysis),
          onChange(model) {
            if (select.disabled || !model || !options.some((option) => option.value === model.id)) return;
            select.value = model.id;
            select.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
          },
        },
      );
      root.append(picker.element);
    }
    picker.setSelectedModel(select.value, { silent: true });
    picker.trigger.disabled = select.disabled;
    picker.trigger.setAttribute('aria-label', select.getAttribute('aria-label') || 'Seleccionar modelo');
    if (select.disabled) picker.element.closeModelPicker?.();
  }
  select.addEventListener('change', refresh);
  refresh();
  return {
    root,
    refresh,
    destroy({ restore = true } = {}) {
      picker?.destroy();
      select.removeEventListener('change', refresh);
      if (restore) {
        select.hidden = original.hidden;
        select.tabIndex = original.tabIndex;
        root.replaceWith(select);
      } else root.remove();
    },
  };
}
