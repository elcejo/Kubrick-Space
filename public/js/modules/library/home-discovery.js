import { renderIcon } from '../../icons.js';
import { safeHTML, escapeHTML as esc } from '../../safe-html.js';
export const CREATION_ENTRIES = Object.freeze([
  {
    type: 'book',
    category: 'story-book',
    name: 'Story Book',
    note: 'Escribe el origen de todo.',
    image: 'story.png',
    icon: 'book',
    tone: 'coral',
  },
  {
    type: 'book',
    category: 'screenplay',
    name: 'Guión',
    note: 'De la historia al siguiente plano.',
    image: 'screenplay.webp',
    icon: 'document',
    tone: 'rose',
  },
  {
    type: 'character',
    category: 'secondary',
    name: 'Personaje',
    note: 'Dale rostro a tu imaginación.',
    image: 'character.png',
    icon: 'character',
    tone: 'orange',
  },
  {
    type: 'stage',
    category: 'interior',
    name: 'Escenario',
    note: 'Construye un mundo propio.',
    image: 'world.png',
    icon: 'stage',
    tone: 'green',
  },
  {
    type: 'video',
    category: 'feature',
    name: 'Largometraje',
    note: 'Tus planos, una película.',
    image: 'feature-film.webp',
    icon: 'video',
    tone: 'violet',
  },
]);
// Each demo has its own original artwork; shorts do not reuse the feature gallery.
export const DEMO_FILMS = Object.freeze([
  {
    title: 'La ciudad que sueña',
    genre: 'Ciencia ficción',
    image: 'city-dream.webp',
    maker: 'Estudio demo · 01',
    format: 'film',
  },
  {
    title: 'La hora dorada',
    genre: 'Aventura',
    image: 'golden-hour.webp',
    maker: 'Estudio demo · 02',
    format: 'film',
  },
  {
    title: 'Donde empieza la noche',
    genre: 'Misterio',
    image: 'night-lighthouse.webp',
    maker: 'Estudio demo · 03',
    format: 'film',
  },
  {
    title: 'Una señal lejana',
    genre: 'Ciencia ficción',
    image: 'distant-signal.webp',
    maker: 'Estudio demo · 04',
    format: 'film',
  },
  {
    title: 'El movimiento del rojo',
    genre: 'Danza',
    image: 'short-dance.webp',
    maker: 'Estudio demo · 05',
    format: 'short',
  },
  {
    title: 'Antes de la salida',
    genre: 'Retrato',
    image: 'short-racer.webp',
    maker: 'Estudio demo · 06',
    format: 'short',
  },
  {
    title: 'Un instante de luz',
    genre: 'Naturaleza',
    image: 'short-butterfly.webp',
    maker: 'Estudio demo · 07',
    format: 'short',
  },
  {
    title: 'La vida en azul',
    genre: 'Naturaleza',
    image: 'short-jellyfish.webp',
    maker: 'Estudio demo · 08',
    format: 'short',
  },
]);
export function renderDiscovery(root) {
  root.querySelector('#creation-grid').innerHTML = safeHTML(
    CREATION_ENTRIES.map(
      (entry) =>
        `<a class="creation-card creation-card--${entry.tone}" href="#/wizard/${entry.type}/${entry.category}"><img src="/assets/home/${entry.image}" alt="" loading="lazy"><span class="creation-card__icon">${renderIcon(entry.icon, 20)}</span><span class="creation-card__copy"><strong>${entry.name}</strong><span>${entry.note}</span></span><span class="creation-card__arrow">${renderIcon('arrow-up-right', 20)}</span></a>`,
    ).join(''),
  );
  root.querySelector('#community-grid').innerHTML = safeHTML(
    DEMO_FILMS.filter((film) => film.format === 'film')
      .map(
        (film) =>
          `<button class="showcase-card" data-demo-film="${DEMO_FILMS.indexOf(film)}" aria-label="Ver propuesta visual de ${esc(film.title)}"><span class="showcase-card__art"><img src="/assets/home/${film.image}" alt="" loading="lazy"><span class="showcase-card__play">${renderIcon('play', 22)}</span><small>${film.genre}</small></span><span class="showcase-card__copy"><strong>${film.title}</strong><small>${film.maker}</small></span></button>`,
      )
      .join(''),
  );
  root.querySelector('#shorts-grid').innerHTML = safeHTML(
    DEMO_FILMS.filter((film) => film.format === 'short')
      .map(
        (film, index) =>
          `<button class="short-card" data-demo-film="${DEMO_FILMS.indexOf(film)}" aria-label="Ver propuesta visual de ${esc(film.title)}"><img src="/assets/home/${film.image}" alt="" loading="lazy"><span class="short-card__number">0${index + 1}</span><span class="short-card__copy"><small>EXPLORACIONES VISUALES</small><strong>${film.title}</strong><span>${renderIcon('play', 18)} Vista previa</span></span></button>`,
      )
      .join(''),
  );
  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.06 },
    );
    root.querySelectorAll('.discovery-section').forEach((el) => {
      el.classList.add('has-reveal');
      observer.observe(el);
    });
    return () => observer.disconnect();
  }
  return () => {};
}
