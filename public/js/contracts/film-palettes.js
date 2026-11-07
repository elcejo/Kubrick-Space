/**
 * The colour palette of a scene: a named set of twelve colours the author picks, or a custom one typed as hex values.
 * The palette travels into every prompt of the scene as colour words (H3 follows named colours, not hex codes), so a
 * custom palette is described by the nearest colour name of each swatch. Portable: no DOM, network or storage.
 */
const palette = (id, name, colors, hint, phrase) => Object.freeze({ id, name, colors, hint, phrase });

export const FILM_PALETTES = Object.freeze([
  palette(
    'desert-dusk',
    'Desert Dusk',
    [
      '#1b1410',
      '#3a2418',
      '#6b3f22',
      '#a35d2b',
      '#d48a3c',
      '#e9b86a',
      '#f2d9a0',
      '#c9704a',
      '#7a8a8f',
      '#4d6b78',
      '#2c3e4a',
      '#efe6d2',
    ],
    'Crepúsculo de desierto: sombras marrones, naranja quemado, ámbar y arena con acentos azul pizarra.',
    'desert dusk colour palette: deep brown shadows, burnt orange, amber and sand highlights, cool slate-blue accents',
  ),
  palette(
    'neon-rain',
    'Neon Rain',
    [
      '#0b0d12',
      '#1a2b3a',
      '#2f5d62',
      '#8a3b2a',
      '#c9573d',
      '#e0a24a',
      '#4a78a8',
      '#8fb3c9',
      '#a89a8c',
      '#e8d5a8',
      '#3c4a6b',
      '#f2e8d0',
    ],
    'Noche urbana lluviosa: negros azulados, verde petróleo y toques cálidos de neón.',
    'rainy neon night colour palette: blue-black shadows, petrol teal, warm red-orange neon accents, pale cream highlights',
  ),
  palette(
    'nostalgic-blue',
    'Nostalgic Blue',
    [
      '#0b2a6b',
      '#1b4aa6',
      '#2d6fd1',
      '#6f8fbf',
      '#c9d3e6',
      '#e8d9d0',
      '#c98a7a',
      '#a34a42',
      '#2a1d22',
      '#f0e4e0',
      '#d9a79a',
      '#5b7aaa',
    ],
    'Azul profundo con rosas empolvados y rojo apagado: melancolía de postal antigua.',
    'nostalgic blue colour palette: saturated cobalt blue, dusty pink, muted brick red, soft cream',
  ),
  palette(
    'soft-linen',
    'Soft Linen',
    [
      '#8a8176',
      '#a39b8f',
      '#bdb6aa',
      '#d2ccc2',
      '#e6e1d8',
      '#cfc4bf',
      '#9a7f6f',
      '#7a6a5d',
      '#b08f7e',
      '#5e5246',
      '#4a4036',
      '#efece6',
    ],
    'Neutros cálidos y suaves: lino, arena grisácea y marrones tenues.',
    'soft neutral colour palette: warm greige, linen, pale sand and muted brown, low saturation',
  ),
  palette(
    'black-gloss',
    'Black Gloss',
    [
      '#050505',
      '#171717',
      '#2a2a2a',
      '#444444',
      '#6b645a',
      '#8c8478',
      '#b3a78f',
      '#d8cfb8',
      '#3a342c',
      '#1f1b17',
      '#908a80',
      '#c8c0ae',
    ],
    'Negros brillantes y grises cálidos: contraste alto, casi monocromo.',
    'near-monochrome colour palette: glossy blacks, warm greys and bone highlights, high contrast',
  ),
  palette(
    'emerald-ambush',
    'Emerald Ambush',
    [
      '#101a14',
      '#1e3a2b',
      '#2f5d44',
      '#4e7a54',
      '#7e9a6b',
      '#a9b88c',
      '#6a8caf',
      '#3c5a78',
      '#7a6a52',
      '#b9a47a',
      '#d9d2b8',
      '#0b1410',
    ],
    'Bosque húmedo: verdes esmeralda y musgo con azul frío y tierra.',
    'damp forest colour palette: emerald and moss greens, cool blue accents, earthy brown, hazy cream highlights',
  ),
  palette(
    'crimson-stage',
    'Crimson Stage',
    [
      '#0d0708',
      '#2a0c10',
      '#5a121a',
      '#8f1d26',
      '#c22b2f',
      '#e0553f',
      '#f08a5d',
      '#f2c18d',
      '#3a1f2e',
      '#6a3b57',
      '#c9a0a8',
      '#f4e3d6',
    ],
    'Escenario teatral: rojos carmesí, ciruela y piel cálida sobre negros profundos.',
    'theatrical crimson colour palette: deep reds, plum and warm skin tones on rich black shadows',
  ),
  palette(
    'teal-orange',
    'Teal & Orange',
    [
      '#08161a',
      '#0f3a45',
      '#1b6b78',
      '#3aa3a8',
      '#8fd0c8',
      '#d8efe3',
      '#f2c78f',
      '#e69a4a',
      '#c9682a',
      '#8a3f1d',
      '#4a2514',
      '#1a0e09',
    ],
    'Clásico de cine: sombras turquesa y luces naranja cálido.',
    'classic cinema teal-and-orange colour palette: teal shadows, warm orange highlights, clean skin tones',
  ),
  palette(
    'pink-velvet',
    'Pink Velvet',
    [
      '#1a0f14',
      '#5a2338',
      '#8f3a55',
      '#c25f7a',
      '#e895a8',
      '#f3c1ca',
      '#f7e1dc',
      '#d9a58f',
      '#a86a5a',
      '#6b4a58',
      '#4a3a52',
      '#fff3ee',
    ],
    'Rosas aterciopelados, burdeos y cremas: dulce y teatral.',
    'pink velvet colour palette: rose, burgundy and cream, soft saturated pinks with deep wine shadows',
  ),
  palette(
    'industrial-fog',
    'Industrial Fog',
    [
      '#1a1d20',
      '#32373c',
      '#4b5258',
      '#6b7379',
      '#8c9499',
      '#a9b0b4',
      '#c4c9cb',
      '#dcdedc',
      '#7a6b60',
      '#5a4338',
      '#3a2a24',
      '#f2f1ee',
    ],
    'Niebla industrial: grises fríos con ladrillo apagado y marrón.',
    'foggy industrial colour palette: cool concrete greys, muted brick brown, pale haze, low saturation',
  ),
  palette(
    'golden-hour',
    'Golden Hour',
    [
      '#1a1208',
      '#4a3010',
      '#8a5a14',
      '#c98a1c',
      '#f0b83a',
      '#f7d98a',
      '#fbeec8',
      '#e8845a',
      '#b8503a',
      '#6b3a3a',
      '#8aa0b5',
      '#4a6080',
    ],
    'Hora dorada: ámbar, miel y coral con sombras azules suaves.',
    'golden hour colour palette: honey amber and gold highlights, coral warmth, soft blue shadows',
  ),
  palette(
    'bioluminescent-night',
    'Bioluminescent Night',
    [
      '#05070f',
      '#0f1a3a',
      '#1b2f6b',
      '#2f4fa8',
      '#4a7fd8',
      '#38b6a8',
      '#6fe0c0',
      '#a77fe0',
      '#6a3fb0',
      '#2a1f5a',
      '#d9a0d0',
      '#e8f4f8',
    ],
    'Noche bioluminiscente: azules profundos, turquesa luminoso y violeta.',
    'bioluminescent night colour palette: deep ultramarine, glowing aqua-green and violet accents on near-black',
  ),
  palette(
    'faded-fresco',
    'Faded Fresco',
    [
      '#2a2620',
      '#5e5648',
      '#8a7f6a',
      '#b3a78a',
      '#d4c9a8',
      '#e8dfc4',
      '#c9a48a',
      '#a8704f',
      '#7a8a7a',
      '#a9bfa8',
      '#c8d8c4',
      '#f4efdc',
    ],
    'Fresco desvaído: ocres, salvia y terracota empolvados.',
    'faded fresco colour palette: dusty ochre, sage green, terracotta and plaster cream, chalky and low contrast',
  ),
  palette(
    'sunburnt-wasteland',
    'Sunburnt Wasteland',
    [
      '#1a0d05',
      '#4a230e',
      '#8a3d12',
      '#c4621c',
      '#e8903a',
      '#f4bf6a',
      '#8a9a6a',
      '#5a6a3a',
      '#3a4a30',
      '#d9c8a0',
      '#7a5a3a',
      '#fbe9c4',
    ],
    'Páramo quemado por el sol: naranjas óxido, verdes secos y arena.',
    'sunburnt wasteland colour palette: rust orange, scorched amber, dry olive green and bleached sand',
  ),
  palette(
    'arctic-silver',
    'Arctic Silver',
    [
      '#0d1216',
      '#1f2b33',
      '#35505e',
      '#5b8294',
      '#8fb4c4',
      '#c1dae3',
      '#e6f0f4',
      '#ffffff',
      '#9aa5ab',
      '#6a747a',
      '#3a4045',
      '#d0c8c0',
    ],
    'Ártico plateado: azules hielo, grises metálicos y blancos fríos.',
    'arctic silver colour palette: ice blue, steel grey and cold white, cool and clean',
  ),
  palette(
    'candy-pop',
    'Candy Pop',
    [
      '#1a1030',
      '#3a1f7a',
      '#6a3fd8',
      '#a64fe0',
      '#e84fa8',
      '#ff7a9a',
      '#ffb36a',
      '#ffe36a',
      '#8fe8a8',
      '#4fd8e0',
      '#4f8ae8',
      '#fff4fa',
    ],
    'Pop saturado: violetas, rosas chicle, amarillo limón y turquesa.',
    'candy pop colour palette: saturated violet, bubblegum pink, lemon yellow, mint and aqua, playful and bright',
  ),
]);

export const FILM_PALETTE_MAX_COLORS = 12;
const HEX = /^#[0-9a-f]{6}$/i;

/** True when a value is the id of a catalogue palette, "auto" or "custom". */
export const isFilmPaletteChoice = (value) =>
  value === 'auto' || value === 'custom' || FILM_PALETTES.some((item) => item.id === value);

/** The colours typed by the author as a clean list of lower-case #rrggbb values, or null when one is not valid. */
export function filmPaletteColors(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > FILM_PALETTE_MAX_COLORS) return null;
  if (!value.every((color) => typeof color === 'string' && HEX.test(color))) return null;
  return value.map((color) => color.toLowerCase());
}

/** Reads "#aabbcc, 336699 f0f" typed by a person into a list of #rrggbb values; anything else is dropped. */
export function parseFilmPaletteInput(text) {
  const colors = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const token = raw.replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(token))
      colors.push(
        '#' +
          [...token]
            .map((digit) => digit + digit)
            .join('')
            .toLowerCase(),
      );
    else if (/^[0-9a-f]{6}$/i.test(token)) colors.push('#' + token.toLowerCase());
  }
  return colors.slice(0, FILM_PALETTE_MAX_COLORS);
}

const NAMED = [
  ['black', 0x0a0a0a],
  ['charcoal', 0x2e2e2e],
  ['grey', 0x808080],
  ['silver', 0xb8b8b8],
  ['white', 0xf5f5f5],
  ['cream', 0xf2e8d0],
  ['sand', 0xd9c08c],
  ['beige', 0xc8b394],
  ['brown', 0x6b4226],
  ['dark brown', 0x2e1a10],
  ['rust', 0xa04a1e],
  ['burnt orange', 0xc2571a],
  ['orange', 0xf08a1c],
  ['amber', 0xe0a020],
  ['gold', 0xd8b030],
  ['yellow', 0xf2d92a],
  ['olive', 0x6b6b2a],
  ['lime', 0xa8d82a],
  ['moss green', 0x4a6b30],
  ['green', 0x2f9a44],
  ['emerald', 0x1f7a56],
  ['mint', 0x8fe0b0],
  ['teal', 0x1f8a8a],
  ['aqua', 0x4fd8e0],
  ['sky blue', 0x6fb0e8],
  ['blue', 0x2f5fd8],
  ['navy', 0x14234a],
  ['indigo', 0x3a2f9a],
  ['violet', 0x7a3fd8],
  ['purple', 0x6a2a8a],
  ['magenta', 0xd02a9a],
  ['pink', 0xf08ab0],
  ['dusty pink', 0xc9a0a8],
  ['red', 0xd02a2a],
  ['crimson', 0x8f1228],
  ['burgundy', 0x4a1020],
  ['slate', 0x4d5b6a],
];

/** The nearest colour name of a #rrggbb value, in plain English. */
export function filmColorName(hex) {
  const value = parseInt(String(hex).replace('#', ''), 16);
  const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const [r, g, b] = rgb(value);
  let best = NAMED[0][0];
  let gap = Infinity;
  for (const [name, color] of NAMED) {
    const [cr, cg, cb] = rgb(color);
    // Weighted distance: the eye is most sensitive to green and least to blue.
    const distance = 2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2;
    if (distance < gap) {
      gap = distance;
      best = name;
    }
  }
  return best;
}

/** The prompt phrase of a scene palette ("auto" is empty). `custom` is the list of hex colours of a custom palette. */
export function filmPalettePhrase(choice, custom = null) {
  if (!choice || choice === 'auto') return '';
  if (choice === 'custom') {
    const colors = filmPaletteColors(custom);
    if (!colors) return '';
    const names = [...new Set(colors.map(filmColorName))];
    return `colour palette of the scene: ${names.join(', ')}; keep the whole picture within these colours`;
  }
  return FILM_PALETTES.find((item) => item.id === choice)?.phrase || '';
}
