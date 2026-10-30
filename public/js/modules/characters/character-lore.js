import { characterElement as el, characterAction as action } from './character-ui.js';
import { Modal } from '../../ui-components.js';
import { characterLoreVisualKind } from './character-model.js';

/** An offer is not character data. Only explicit checked facts can be approved. */
export function renderCharacterLore(host) {
  const lore = host.document.lore;
  const stamp = JSON.stringify([lore, host.busy]);
  const container = host.narrativeNode?.loreContainer;
  if (host.loreStamp === stamp && container?.querySelector('.character-lore')) return;
  host.loreStamp = stamp;
  container?.replaceChildren();
  const pendingVisual =
    lore?.status === 'applied'
      ? lore.facts.filter(
          (fact) =>
            lore.approvedIds?.includes(fact.id) &&
            characterLoreVisualKind(fact) &&
            !lore.visualAssets?.some((entry) => entry.factId === fact.id),
        )
      : [];
  const offerStamp = lore ? JSON.stringify([lore.name, lore.work, lore.facts]) : '';
  if (lore?.status === 'offered' || pendingVisual.length) {
    if (
      !host.busy &&
      !host.visualLibraryBusy &&
      !host.photoGenerating &&
      host.lorePromptShown !== offerStamp &&
      host.current()
    ) {
      host.lorePromptShown = offerStamp;
      const content = el('div', 'character-lore-offer');
      content.append(
        el('p', null, `Se encontró información en línea de ${lore.name} · ${lore.work}.`),
        el(
          'p',
          null,
          'Puedes revisar los datos y elegir cuáles agregar. Los elementos visuales se crearán como piezas disponibles en Outfit y la biblioteca universal, sin seleccionarlos ni cambiar la fotografía.',
        ),
      );
      host.loreDialog = content;
      Modal.show({
        title: 'Información del personaje encontrada',
        content,
        preserveCurrent: true,
        actions: [
          { label: 'Recordar luego', class: 'btn-ghost btn-md', onClick: () => Modal.hide() },
          {
            label: 'Cancelar',
            class: 'btn-secondary btn-md',
            onClick: async () => {
              if (await host.resolveLore({ dismiss: true })) Modal.hide();
            },
          },
          {
            label: 'OK',
            class: 'btn-primary btn-md',
            onClick: () => {
              Modal.hide();
              reviewLore(host, lore, pendingVisual.length ? pendingVisual : lore.facts);
            },
          },
        ],
      });
    }
    return;
  }
  if (!container || !lore || !['offered', 'ambiguous', 'unavailable'].includes(lore.status)) return;
  const panel = el('section', 'character-lore');
  panel.setAttribute('aria-label', 'Lore previo del personaje');
  panel.append(
    el(
      'strong',
      null,
      lore.status === 'offered' ? `Lore disponible · ${lore.name}` : 'Referencias del personaje',
    ),
  );
  panel.append(
    el(
      'p',
      null,
      lore.status === 'offered' ? `${lore.work}. Revisa los datos y elige cuáles incorporar.` : lore.message,
    ),
  );
  const buttons = el('div', 'character-lore__actions');
  if (lore.status === 'offered')
    buttons.append(action('Revisar datos', 'book', () => reviewLore(host, lore), 'btn btn-secondary'));
  else
    buttons.append(
      action(
        'Reintentar búsqueda',
        'refresh',
        () =>
          void host.enqueueBackgroundJob({ kind: 'lore', request: host.document.history[0]?.request || '' }),
        'btn btn-secondary',
      ),
    );
  buttons.append(
    action('Descartar', 'close', () => void host.resolveLore({ dismiss: true }), 'btn btn-ghost'),
  );
  for (const button of buttons.children) button.disabled = Boolean(host.busy);
  panel.append(buttons);
  container.append(panel);
}
function reviewLore(host, lore, facts = lore.facts) {
  if (host.busy || !host.current()) return;
  const root = el('div', 'character-lore-review');
  const snapshot = JSON.stringify(lore),
    selected = new Set();
  root.append(
    el('p', null, `${lore.name} · ${lore.work}`),
    el(
      'p',
      'character-lore-review__hint',
      'Solo se incorporarán los datos que marques. Los datos narrativos, edad y estatura actualizan la ficha. Los detalles visuales crearán piezas opcionales en Outfit y la biblioteca universal, sin seleccionarlas ni cambiar la fotografía.',
    ),
  );
  const list = el('div', 'character-lore-review__facts');
  const apply = action(
    'Incorporar seleccionados',
    'check',
    async () => {
      if (host.busy || !host.current() || snapshot !== JSON.stringify(host.document.lore)) return;
      apply.disabled = true;
      const saved = await host.resolveLore({ ids: [...selected] });
      if (saved) Modal.hide();
      else apply.disabled = !selected.size;
    },
    'btn btn-primary btn-md',
  );
  apply.disabled = true;
  for (const fact of facts) {
    const label = el('label', 'character-lore-fact');
    const check = el('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', `Incorporar ${fact.label}`);
    check.addEventListener('change', () => {
      check.checked ? selected.add(fact.id) : selected.delete(fact.id);
      apply.disabled = !selected.size;
    });
    const copy = el('span');
    copy.append(el('strong', null, fact.label), el('span', null, String(fact.value)));
    if (characterLoreVisualKind(fact))
      copy.append(el('small', null, 'Referencia visual opcional · no se aplica al personaje'));
    const current = characterLoreVisualKind(fact)
      ? undefined
      : fact.kind === 'narrative'
        ? host.document.narrative[fact.key]
        : host.document.fields.find((field) =>
            fact.kind === 'age'
              ? /(?:^|\.)age$/.test(field.key)
              : fact.kind === 'height'
                ? /(?:^|\.)(height|height_cm|estatura)$/.test(field.key)
                : field.key ===
                  (fact.kind === 'occupation' ? 'custom.occupation' : 'custom.lore.' + fact.key),
          )?.value;
    if (current !== undefined && current !== null && current !== '')
      copy.append(el('small', null, `Actual: ${current}`));
    label.append(check, copy);
    list.append(label);
  }
  const sources = el('div', 'character-lore-review__sources');
  sources.append(el('strong', null, 'Fuentes'));
  for (const source of lore.sources) {
    const link = el('a', null, source.title || new URL(source.url).hostname);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    sources.append(link);
  }
  const footer = el('div', 'character-lore__actions');
  footer.append(
    action('Cancelar', 'close', () => Modal.hide(), 'btn btn-secondary btn-md'),
    apply,
  );
  root.append(list, sources, footer);
  host.loreDialog = root;
  Modal.show({
    title: 'Incorporar lore previo',
    content: root,
    initialFocus: list.querySelector('input'),
    preserveCurrent: true,
  });
}
