import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

/** Turn the existing ingredient controls into the reverse of a portrait card. */
export function mountIngredientCard(root, ingredient) {
  let disposed = false;
  const listeners = [];
  const listen = (element, type, callback, options) => {
    element.addEventListener(type, callback, options);
    listeners.push(() => element.removeEventListener(type, callback, options));
  };
  const doc = root.ownerDocument;
  const colorControls = root.querySelectorAll('.kai-color-picker');
  const rotor = doc.createElement('div');
  rotor.className = 'ingredient-card__rotor';
  const back = doc.createElement('div');
  back.className = 'ingredient-card__back';
  const content = doc.createElement('div');
  content.className = 'ingredient-card__scroll';
  listen(content, 'wheel', (event) => event.stopPropagation(), { passive: true });
  const header = root.querySelector('.ingredient-card__header');
  const footer = root.querySelector('.ingredient-card__footer');
  const portrait = root.querySelector('.ingredient-card__portrait');
  const name =
    root.querySelector('.ingredient-card__name, .ingredient-card__term')?.textContent || ingredient.label;
  portrait?.remove();
  const front = doc.createElement('button');
  front.type = 'button';
  front.className = 'ingredient-card__front';
  front.setAttribute('aria-label', `Ver información y controles de ${name}`);
  front.setAttribute('aria-expanded', 'false');
  if (colorControls.length) {
    const first = /^#[\da-f]{6}$/i.test(ingredient.color1 || '') ? ingredient.color1 : '#6366f1';
    const second = /^#[\da-f]{6}$/i.test(ingredient.color2 || '') ? ingredient.color2 : '#a855f7';
    root.style.setProperty('--ingredient-color-1', first);
    root.style.setProperty('--ingredient-color-2', second);
    front.classList.add('ingredient-card__front--gradient');
  }
  if (portrait) {
    portrait.alt = '';
    portrait.loading = 'eager';
    front.appendChild(portrait);
  } else {
    front.classList.add('ingredient-card__front--typographic');
    const symbol = doc.createElement('span');
    symbol.className = 'ingredient-card__symbol';
    symbol.innerHTML = safeHTML(renderIcon(ingredient.type === 'definition' ? 'tag' : ingredient.type, 40));
    front.appendChild(symbol);
  }
  const caption = doc.createElement('span');
  caption.className = 'ingredient-card__caption';
  const category = doc.createElement('span');
  category.className = 'ingredient-card__eyebrow';
  category.textContent = ingredient.type === 'definition' ? 'Definición' : ingredient.label;
  const title = doc.createElement('span');
  title.className = 'ingredient-card__front-name';
  title.textContent = name;
  const hint = doc.createElement('span');
  hint.className = 'ingredient-card__hint';
  hint.innerHTML = safeHTML(`Explorar ${renderIcon('arrow-up-right', 12)}`);
  caption.append(category, title, hint);
  front.appendChild(caption);
  if (header) back.appendChild(header);
  footer?.remove();
  while (root.firstChild) content.appendChild(root.firstChild);
  back.appendChild(content);
  if (footer) back.appendChild(footer);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'ingredient-card__return';
  close.innerHTML = safeHTML(renderIcon('chevron-left', 16));
  close.setAttribute('aria-label', 'Volver a la imagen');
  header?.prepend(close);
  rotor.append(front, back);
  root.appendChild(rotor);
  root.classList.add('ingredient-card--flip');
  root.classList.toggle('ingredient-card--definition', ingredient.type === 'definition');
  const isCharacter = ingredient.type === 'character';
  root.classList.toggle('ingredient-card--character', isCharacter);
  let open = false;
  let phase = 'front';
  let transitionToken = 0;
  let cancelPendingTransition = () => {};
  const transitionDuration = (element, property) => {
    const styles = doc.defaultView?.getComputedStyle?.(element);
    if (!styles) return 0;
    const properties = (styles.transitionProperty || '').split(',').map((value) => value.trim());
    const durations = (styles.transitionDuration || '').split(',').map((value) => value.trim());
    const delays = (styles.transitionDelay || '').split(',').map((value) => value.trim());
    const toMilliseconds = (value) => (value?.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000);
    let maximum = 0;
    properties.forEach((name, index) => {
      if (name !== property && name !== 'all') return;
      maximum = Math.max(
        maximum,
        toMilliseconds(durations[index % Math.max(1, durations.length)] || '0s') +
          toMilliseconds(delays[index % Math.max(1, delays.length)] || '0s'),
      );
    });
    return Number.isFinite(maximum) ? maximum : 0;
  };
  const afterTransition = (element, property, token, callback) => {
    const duration = transitionDuration(element, property);
    if (duration <= 0) {
      queueMicrotask(() => {
        if (token === transitionToken) callback();
      });
      return () => {};
    }
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener('transitionend', onEnd);
      element.removeEventListener('transitioncancel', onCancel);
    };
    const onEnd = (event) => {
      if (event && (event.target !== element || event.propertyName !== property)) return;
      cleanup();
      if (token === transitionToken) callback();
    };
    const onCancel = (event) => {
      if (event && (event.target !== element || event.propertyName !== property)) return;
      // A canceled transition is not a completed transition. CSS may start a
      // replacement transition for the new target; wait for that transition's
      // end, with a fresh watchdog in case the browser emits no end event.
      clearTimeout(timer);
      timer = setTimeout(() => onEnd(), duration + 80);
    };
    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', onCancel);
    timer = setTimeout(() => onEnd(), duration + 80);
    return cleanup;
  };
  const show = (value) => {
    if (disposed) return;
    if (open === value && (value || phase === 'front' || phase === 'shrinking' || phase === 'flipping-close'))
      return;
    open = value;
    const token = ++transitionToken;
    cancelPendingTransition();
    back.inert = !value;
    front.tabIndex = value ? -1 : 0;
    front.setAttribute('aria-expanded', String(value));

    if (!isCharacter) {
      root.classList.toggle('is-flipped', value);
      phase = value ? 'back' : 'front';
      return;
    }

    if (value) {
      if (phase === 'back') return;
      if (phase === 'expanding') {
        phase = 'back';
        return;
      }
      if (phase === 'shrinking') {
        root.classList.add('is-card-expanded');
        phase = 'back';
        return;
      }
      root.classList.add('is-flipped');
      phase = 'flipping-open';
      cancelPendingTransition = afterTransition(front, 'transform', token, () => {
        if (!open) return;
        root.classList.add('is-card-expanded');
        phase = 'expanding';
        cancelPendingTransition = afterTransition(root, 'height', token, () => {
          phase = 'back';
        });
      });
      return;
    }

    if (phase === 'front') return;
    if (root.classList.contains('is-card-expanded')) {
      root.classList.remove('is-card-expanded');
      phase = 'shrinking';
      cancelPendingTransition = afterTransition(root, 'height', token, () => {
        if (open) return;
        root.classList.remove('is-flipped');
        phase = 'flipping-close';
        cancelPendingTransition = afterTransition(front, 'transform', token, () => {
          phase = 'front';
        });
      });
      return;
    }

    root.classList.remove('is-flipped');
    phase = 'flipping-close';
    cancelPendingTransition = afterTransition(front, 'transform', token, () => {
      phase = 'front';
    });
  };
  back.inert = true;
  front.tabIndex = 0;
  front.setAttribute('aria-expanded', 'false');
  show(false);
  let leaveTimer = null;
  let pointerPosition = null;
  const pointerIsWithinCard = () => {
    if (!pointerPosition) return false;
    const rect = root.getBoundingClientRect();
    return (
      pointerPosition.x >= rect.left &&
      pointerPosition.x < rect.right &&
      pointerPosition.y >= rect.top &&
      pointerPosition.y < rect.bottom
    );
  };
  listen(root, 'pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    clearTimeout(leaveTimer);
    pointerPosition = { x: event.clientX, y: event.clientY };
    show(true);
  });
  listen(root, 'pointermove', (event) => {
    if (event.pointerType !== 'touch') pointerPosition = { x: event.clientX, y: event.clientY };
  });
  listen(root, 'pointerleave', (event) => {
    if (event.pointerType === 'touch' || back.contains(doc.activeElement)) return;
    pointerPosition = { x: event.clientX, y: event.clientY };
    clearTimeout(leaveTimer);
    // During rotateY the front and back exchange hit-tested surfaces. Defer
    // closing and use the stable card rectangle so that brief 3D hit-test gaps
    // do not reverse the animation mid-flip.
    leaveTimer = setTimeout(() => {
      if (
        !root.isConnected ||
        back.contains(doc.activeElement) ||
        root.querySelector('.kai-color-picker[aria-expanded="true"]')
      )
        return;
      if (!root.matches(':hover') && !pointerIsWithinCard()) show(false);
    }, 500);
  });
  listen(root, 'focusout', () => {
    queueMicrotask(() => {
      if (doc.querySelector('.modal-overlay, .kai-color-dialog[open]')) return;
      if (!root.contains(doc.activeElement) && !root.matches(':hover')) show(false);
    });
  });
  listen(front, 'click', () => {
    show(true);
    close.focus({ preventScroll: true });
  });
  const returnToFront = () => {
    show(false);
    front.focus({ preventScroll: true });
  };
  listen(close, 'click', returnToFront);
  listen(root, 'keydown', (event) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      returnToFront();
    }
  });
  return () => {
    if (disposed) return;
    disposed = true;
    transitionToken++;
    clearTimeout(leaveTimer);
    cancelPendingTransition();
    listeners.splice(0).forEach((remove) => remove());
  };
}
