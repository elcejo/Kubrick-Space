const STORAGE_KEY = 'kai-roadmap-progress-v1';
const PROJECT_META = {
  'story-book': { label: 'Story-book', className: 'story-book' },
  screenplay: { label: 'Guión', className: 'screenplay' },
  film: { label: 'Película', className: 'film' },
  character: { label: 'Personaje', className: 'character' },
  stage: { label: 'Escenario', className: 'stage' },
  music: { label: 'Música', className: 'music' },
  global: { label: 'General', className: 'global' },
};

// Keep the project scope explicit so a card can affect several creative
// surfaces while still showing its visual ownership in the roadmap.
const PROJECTS_BY_ID = {
  'foundation-outline-tree': ['story-book'],
  'foundation-outline-index': ['story-book'],
  'foundation-outline-paragraph-drag': ['story-book'],
  'foundation-outline-theme-drag': ['story-book'],
  'foundation-outline-dnd-isolation': ['story-book', 'global'],
  'foundation-story-book-json-model': ['story-book'],
  'foundation-outline-chapter-drag': ['story-book'],
  'foundation-outline-scenes': ['screenplay', 'film'],
  'writing-cover-concepts': ['story-book'],
  'writing-cover-context-scope': ['story-book'],
  'writing-timeline-story-book': ['story-book'],
  'writing-timeline': ['screenplay', 'film'],
  'foundation-context-sessions': ['story-book', 'screenplay', 'film', 'character', 'stage', 'music'],
  'foundation-context-writing': ['story-book'],
  'foundation-context-workflows': ['story-book', 'screenplay', 'character'],
  'foundation-luna-openrouter-routing': ['story-book', 'screenplay', 'character', 'stage', 'film', 'global'],
  'foundation-llm-settings': ['story-book', 'screenplay', 'character', 'global'],
  'foundation-openrouter-model-catalog': [
    'story-book',
    'screenplay',
    'character',
    'stage',
    'film',
    'music',
    'global',
  ],
  'foundation-documentation': ['global'],
  'foundation-cover-editor': ['story-book', 'character'],
  'foundation-cover-generation-routing': ['story-book', 'character', 'global'],
  'foundation-krea-identity-edit': ['story-book', 'character'],
  'foundation-ai-connectivity-diagnostics': ['global'],
  'foundation-ai-debug-privacy': ['global', 'story-book', 'character'],
  'foundation-navigator-minimal': ['story-book', 'character', 'global'],
  'foundation-versions': ['story-book', 'screenplay', 'film', 'character', 'stage', 'music'],
  'foundation-notes': ['story-book', 'screenplay'],
  'writing-bible': ['story-book', 'screenplay', 'character', 'stage'],
  'writing-arcs': ['character'],
  'story-book-gap-insertion': ['story-book'],
  'writing-structure': ['story-book', 'screenplay'],
  'writing-revision': ['story-book', 'screenplay'],
  'writing-search': ['story-book', 'screenplay', 'film', 'character', 'stage'],
  'adaptation-hub': ['story-book', 'screenplay', 'film'],
  'adaptation-ingredient-versions': ['story-book', 'screenplay', 'film', 'character', 'stage', 'music'],
  'adaptation-screenplay': ['screenplay'],
  'screenplay-reading-layout': ['screenplay'],
  'screenplay-version-recovery': ['screenplay'],
  'screenplay-scene-index': ['screenplay'],
  'screenplay-scene-operations': ['screenplay'],
  'screenplay-source-chooser': ['screenplay', 'story-book'],
  'screenplay-production-provenance': ['screenplay', 'film'],
  'screenplay-location-ingredients': ['screenplay', 'stage'],
  'adaptation-mapping': ['story-book', 'screenplay', 'film'],
  'adaptation-review': ['story-book', 'screenplay'],
  'adaptation-metrics': ['screenplay', 'film'],
  'production-breakdown': ['screenplay', 'film', 'character', 'stage'],
  'production-storyboard': ['film'],
  'production-continuity': ['film', 'character', 'stage'],
  'production-timeline': ['film', 'music'],
  'production-status': ['film'],
  'delivery-formats': ['story-book', 'screenplay', 'film'],
  'delivery-package': ['story-book', 'screenplay', 'film', 'character', 'stage', 'music'],
  'delivery-readiness': ['story-book', 'screenplay', 'film'],
  'delivery-polish': ['story-book', 'screenplay', 'film', 'character', 'stage', 'music'],
};

const root = document.querySelector('.roadmap-page');
if (root) {
  const checks = [...root.querySelectorAll('[data-roadmap-id]')];
  const cards = [...root.querySelectorAll('.roadmap-card, .roadmap-agent-card, .roadmap-infra-card')];
  const phases = [...root.querySelectorAll('[data-phase]')];
  const areas = [...root.querySelectorAll('[data-filter]')];
  const states = [...root.querySelectorAll('[data-state]')];
  const scopes = [...root.querySelectorAll('[data-project]')];
  const priorities = [...root.querySelectorAll('[data-priority]')];
  const search = root.querySelector('[data-roadmap-search]');
  const focusShortcut = root.querySelector('[data-focus]');
  let filter = 'all',
    state = 'pending',
    project = 'all',
    query = '',
    onlyUI = false,
    priority = 'all';

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    /* Optional storage. */
  }
  checks.forEach((check) => {
    // Documented completion is authoritative; older local marks cannot reopen it.
    check.checked = check.defaultChecked || saved[check.dataset.roadmapId] === true;
    check.disabled = check.defaultChecked;
  });

  cards.forEach((card, index) => {
    const check = card.querySelector('[data-roadmap-id]');
    const id = check?.dataset.roadmapId;
    card.dataset.priority = card.textContent.match(/\bP[123]\b/)?.[0] || 'none';
    const assigned =
      card.dataset.roadmapProjects ||
      PROJECTS_BY_ID[id] ||
      (id?.startsWith('timeline-')
        ? ['story-book']
        : id?.startsWith('uiux-')
          ? ['global', 'character', 'story-book', 'screenplay']
          : 'global');
    const keys = (Array.isArray(assigned) ? assigned : assigned.split(','))
      .map((key) => key.trim())
      .filter((key) => PROJECT_META[key]);
    card.dataset.roadmapProjects = keys.join(',');
    if (id) card.id = `task-${id}`;
    const anchor = card.querySelector(':scope > .roadmap-check, :scope > summary, :scope > h3');
    if (!anchor) return;
    const badges = document.createElement('div');
    badges.className = 'roadmap-project-badges';
    badges.setAttribute('aria-label', 'Tipos de proyecto');
    for (const key of keys) {
      const badge = document.createElement('span');
      badge.className = `roadmap-project-badge roadmap-project-badge--${PROJECT_META[key].className}`;
      badge.textContent = PROJECT_META[key].label;
      badges.append(badge);
    }
    if (check) {
      const status = document.createElement('span');
      status.className = 'roadmap-task-state';
      status.dataset.taskState = '';
      badges.prepend(status);
      const priority = card.textContent.match(/\bP[123]\b/)?.[0];
      if (priority) {
        const badge = document.createElement('span');
        badge.className = 'roadmap-task-priority';
        badge.textContent = priority;
        badges.append(badge);
      }
      const details = document.createElement('div');
      details.className = 'roadmap-card__details';
      details.id = `roadmap-details-${index}`;
      details.hidden = true;
      [...card.querySelectorAll(':scope > p')].forEach((paragraph) => details.append(paragraph));
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'roadmap-details-toggle';
      toggle.textContent = 'Detalles';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', details.id);
      toggle.setAttribute('aria-label', `Ver detalles de ${anchor.textContent.trim()}`);
      toggle.addEventListener('click', () => {
        details.hidden = !details.hidden;
        toggle.setAttribute('aria-expanded', String(!details.hidden));
      });
      card.append(toggle, details);
    }
    anchor.insertAdjacentElement('afterend', badges);
  });

  const complete = (card) =>
    card.querySelector('[data-roadmap-id]')?.checked ??
    Boolean(card.querySelector('.roadmap-agent-label.is-done'));
  const save = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          Object.fromEntries(
            checks
              .filter((check) => !check.defaultChecked)
              .map((check) => [check.dataset.roadmapId, check.checked]),
          ),
        ),
      );
    } catch {
      /* The roadmap remains usable without persistence. */
    }
  };
  const matches = (card, status = state) => {
    const text = card.textContent
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es');
    const terms = query
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return (
      (project === 'all' || card.dataset.roadmapProjects.split(',').includes(project)) &&
      (status === 'all' || complete(card) === (status === 'done')) &&
      (priority === 'all' || card.dataset.priority === priority) &&
      (!onlyUI || card.querySelector('[data-roadmap-id]')?.dataset.roadmapId.startsWith('uiux-')) &&
      terms.every((term) => text.includes(term))
    );
  };
  const update = () => {
    const done = checks.filter((check) => check.checked).length;
    const percent = checks.length ? Math.round((done / checks.length) * 100) : 0;
    root.querySelector('[data-progress-value]').textContent = `${percent}%`;
    root.querySelector('[data-progress-bar]').style.setProperty('--progress', `${percent}%`);
    root.querySelector('[data-progress-count]').textContent = `${done} de ${checks.length} tareas`;
    const verified = checks.filter((check) => check.defaultChecked).length;
    root.querySelector('[data-overview-total]').textContent = checks.length;
    root.querySelector('[data-overview-done]').textContent = verified;
    root.querySelector('[data-overview-pending]').textContent = checks.length - verified;
    root.querySelectorAll('.roadmap-hero-stats strong').forEach((stat) => {
      stat.dataset.counterTarget = stat.textContent;
    });
    const migrated = [1, 2, 3].every(
      (stage) => root.querySelector(`[data-roadmap-id="modular-stage-${stage}"]`)?.defaultChecked,
    );
    root.querySelector('[data-foundation-status]').textContent = migrated
      ? 'Migración modular completada'
      : 'Arquitectura modular en desarrollo';
    root.querySelectorAll('[data-open-area]').forEach((button) => {
      const key = button.dataset.openArea;
      const tasks = checks.filter((check) => check.closest('[data-phase]').dataset.phase === key);
      const finished = tasks.filter((check) => check.defaultChecked).length;
      button.querySelector('[data-milestone-state]').textContent =
        `${finished} de ${tasks.length} implementadas`;
      button
        .querySelector('[data-milestone-bar]')
        .style.setProperty('--progress', `${tasks.length ? (finished / tasks.length) * 100 : 0}%`);
    });
    cards.forEach((card) => {
      card.dataset.status = complete(card) ? 'done' : 'pending';
      const badge = card.querySelector('[data-task-state]');
      if (badge) badge.textContent = complete(card) ? 'Completada' : 'Pendiente';
    });
    phases.forEach((phase) => {
      const children = cards.filter((card) => card.closest('[data-phase]') === phase);
      children.forEach((card) => {
        card.hidden = !(filter === 'all' || phase.dataset.phase === filter) || !matches(card);
      });
      phase.hidden = !children.some((card) => !card.hidden);
      const status = phase.querySelector('.roadmap-phase-status');
      const pending = children.filter((card) => !complete(card)).length;
      if (status) status.textContent = pending ? `${pending} pendientes` : 'Completada';
    });
    areas.forEach((area) => {
      const key = area.dataset.filter;
      const active = key === filter;
      area.classList.toggle('is-active', active);
      if (active) area.setAttribute('aria-current', 'true');
      else area.removeAttribute('aria-current');
      const count = cards.filter(
        (card) => (key === 'all' || card.closest('[data-phase]').dataset.phase === key) && matches(card),
      ).length;
      area.querySelector('[data-section-count]').textContent = count;
    });
    states.forEach((button) => {
      const active = button.dataset.state === state;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      const count = checks.filter((check) => {
        const card = check.closest('.roadmap-card');
        return (
          (filter === 'all' || card.closest('[data-phase]').dataset.phase === filter) &&
          matches(card, button.dataset.state)
        );
      }).length;
      button.querySelector('[data-state-count]').textContent = count;
    });
    scopes.forEach((button) => {
      const active = button.dataset.project === project;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    priorities.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.priority === priority)),
    );
    focusShortcut.setAttribute('aria-pressed', String(onlyUI));
    const remainingUI = checks.filter(
      (check) => check.dataset.roadmapId.startsWith('uiux-') && !check.checked,
    ).length;
    focusShortcut.querySelector('span').textContent = `Última auditoría · ${remainingUI} tareas`;
    root.querySelectorAll('.roadmap-note').forEach((note) => {
      note.hidden = state !== 'all' || onlyUI;
    });
    const visible = cards.filter((card) => !card.hidden);
    const tasks = visible.filter((card) => card.querySelector('[data-roadmap-id]')).length;
    const notes = visible.length - tasks;
    root.querySelector('[data-roadmap-results]').textContent =
      `${tasks} ${tasks === 1 ? 'tarea' : 'tareas'}${notes ? ` · ${notes} ${notes === 1 ? 'referencia' : 'referencias'}` : ''}${project !== 'all' ? ` · ${PROJECT_META[project].label}` : ''}`;
    root.querySelector('[data-roadmap-empty]').hidden = visible.length > 0;
  };
  areas.forEach((area) =>
    area.addEventListener('click', (event) => {
      event.preventDefault();
      filter = area.dataset.filter;
      onlyUI = false;
      update();
      root.querySelector('.roadmap-controls').scrollIntoView?.({ block: 'start' });
    }),
  );
  states.forEach((button) =>
    button.addEventListener('click', () => {
      state = button.dataset.state;
      update();
    }),
  );
  scopes.forEach((button) =>
    button.addEventListener('click', () => {
      project = button.dataset.project;
      onlyUI = false;
      update();
    }),
  );
  priorities.forEach((button) =>
    button.addEventListener('click', () => {
      priority = button.dataset.priority;
      update();
    }),
  );
  const openExplorer = ({ area = 'all', targetProject = 'all' }) => {
    filter = area;
    project = targetProject;
    query = '';
    priority = 'all';
    onlyUI = false;
    search.value = '';
    state = checks.some(
      (check) =>
        !check.checked &&
        (area === 'all' || check.closest('[data-phase]').dataset.phase === area) &&
        (targetProject === 'all' ||
          check.closest('.roadmap-card').dataset.roadmapProjects.split(',').includes(targetProject)),
    )
      ? 'pending'
      : 'done';
    update();
    root.querySelector('#explorador').scrollIntoView?.({ block: 'start' });
  };
  root
    .querySelectorAll('[data-open-area]')
    .forEach((button) =>
      button.addEventListener('click', () => openExplorer({ area: button.dataset.openArea })),
    );
  root
    .querySelectorAll('[data-open-project]')
    .forEach((button) =>
      button.addEventListener('click', () => openExplorer({ targetProject: button.dataset.openProject })),
    );
  root.querySelectorAll('[role=group]').forEach((group) =>
    group.addEventListener('keydown', (event) => {
      const buttons = [...group.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
        next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next].focus();
    }),
  );
  search.addEventListener('input', (event) => {
    query = event.target.value;
    update();
  });
  checks.forEach((check) =>
    check.addEventListener('change', () => {
      save();
      update();
    }),
  );
  root.querySelector('[data-reset]').addEventListener('click', () => {
    checks.forEach((check) => {
      check.checked = check.defaultChecked;
    });
    save();
    update();
  });
  root.querySelector('[data-clear-filters]').addEventListener('click', () => {
    filter = 'all';
    state = 'all';
    project = 'all';
    query = '';
    onlyUI = false;
    priority = 'all';
    search.value = '';
    update();
  });
  focusShortcut.addEventListener('click', () => {
    filter = 'architecture';
    state = 'pending';
    project = 'all';
    query = '';
    onlyUI = true;
    priority = 'all';
    search.value = '';
    update();
    root.querySelector('.roadmap-controls').scrollIntoView?.({ block: 'start' });
  });
  update();
  const drawer = root.querySelector('.roadmap-filter-drawer');
  const compact = window.matchMedia?.('(max-width: 900px)');
  const resizeDrawer = () => {
    if (drawer && compact) drawer.open = !compact.matches;
  };
  resizeDrawer();
  compact?.addEventListener?.('change', resizeDrawer);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) compact?.removeEventListener?.('change', resizeDrawer);
  });
  initRoadmapMotion(root);
}

/** Decorative motion only: no scroll interception, layout resizing, or per-card filters. */
function initRoadmapMotion(page) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!window.requestAnimationFrame || !window.IntersectionObserver) return;
  const halo = page.querySelector('[data-parallax="halo"]');
  const dots = page.querySelector('[data-parallax="dots"]');
  const hero = page.querySelector('.roadmap-hero');
  let frame = null,
    counterFrame = null,
    observer = null;
  const paint = () => {
    frame = null;
    const offset = Math.max(0, Math.min(window.scrollY, hero.offsetHeight + 100));
    halo.style.transform = reduced?.matches ? '' : `translate3d(0, ${offset * 0.16}px, 0)`;
    dots.style.transform = reduced?.matches ? '' : `translate3d(0, ${offset * -0.09}px, 0)`;
  };
  const scroll = () => {
    if (!reduced?.matches && frame === null) frame = window.requestAnimationFrame(paint);
  };
  const configure = () => {
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (counterFrame !== null) window.cancelAnimationFrame(counterFrame);
    frame = counterFrame = null;
    if (reduced?.matches) {
      delete page.dataset.scrollEnhanced;
      page.querySelectorAll('.roadmap-hero-stats strong').forEach((stat) => {
        stat.textContent = stat.dataset.counterTarget;
      });
      paint();
      return;
    }
    observer = new window.IntersectionObserver(
      (entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (!isIntersecting) return;
          target.dataset.revealed = 'true';
          observer.unobserve(target);
        });
      },
      { threshold: 0.08 },
    );
    page.querySelectorAll('[data-roadmap-reveal]').forEach((section) => observer.observe(section));
    page.dataset.scrollEnhanced = 'true';
    paint();
    const stats = [...page.querySelectorAll('.roadmap-hero-stats strong')];
    const targets = stats.map((stat) => Number(stat.dataset.counterTarget));
    const start = window.performance.now();
    const count = (now) => {
      const progress = Math.min(1, (now - start) / 650);
      const ease = 1 - (1 - progress) ** 3;
      stats.forEach((stat, index) => {
        stat.textContent = Math.round(targets[index] * ease);
      });
      counterFrame = progress < 1 ? window.requestAnimationFrame(count) : null;
    };
    if (stats.every((_, index) => Number.isFinite(targets[index])))
      counterFrame = window.requestAnimationFrame(count);
  };
  configure();
  window.addEventListener('scroll', scroll, { passive: true });
  reduced?.addEventListener?.('change', configure);
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (counterFrame !== null) window.cancelAnimationFrame(counterFrame);
    window.removeEventListener('scroll', scroll);
    reduced?.removeEventListener?.('change', configure);
  });
}
