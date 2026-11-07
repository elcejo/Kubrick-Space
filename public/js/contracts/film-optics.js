/**
 * The optics of a scene: the camera, the lens and the aperture the author chooses for it. Each choice is written into
 * the technical line of every prompt of the scene as what the picture looks like (grain, flare, depth of field), never
 * as a brand name or a bare number: H3 does not treat millimetres or f-stops as calibrated settings, it follows the
 * visible result and the camera distance. "auto" leaves the framing of each shot to decide, as before.
 * Portable: no DOM, network or storage.
 */
const option = (id, name, icon, hint, phrase = '') => Object.freeze({ id, name, icon, hint, phrase });

export const FILM_CAMERAS = Object.freeze([
  option('auto', 'Auto', 'camera', 'La cámara la decide el plano: no se añade ningún aspecto de cámara.'),
  option(
    'digital',
    'Modern Digital',
    'camera-digital',
    'Cine digital actual: nitidez, gran rango dinámico y color neutro, casi sin grano.',
    'clean modern digital cinema look: crisp detail, wide dynamic range, neutral colour, almost no grain',
  ),
  option(
    '35mm',
    '35mm Film',
    'camera-35mm',
    'Película de 35 mm: grano orgánico fino, altas luces suaves y color natural rico.',
    'shot on 35 mm film: fine organic grain, soft highlight roll-off, rich natural colour',
  ),
  option(
    '16mm',
    '16mm Film',
    'camera-16mm',
    'Película de 16 mm: grano visible, detalle algo suave y color cálido con contraste.',
    '16 mm film look: visible grain, slightly soft detail, warm contrasty colour, a faint gate weave',
  ),
  option(
    '8mm',
    '8mm Film',
    'camera-8mm',
    'Cine doméstico de 8 mm: grano grueso, color desvaído, parpadeo ligero y bordes redondeados.',
    'vintage 8 mm home-movie look: heavy grain, soft low-resolution detail, faded warm colour, light flicker, rounded frame corners',
  ),
  option(
    '65mm',
    '65mm Large Format',
    'camera-65mm',
    'Gran formato de 65 mm: grano finísimo, enorme detalle y degradados suaves; escala épica.',
    'large-format 65 mm film look: extremely fine grain, vast detail, smooth tonal gradation, epic scale',
  ),
  option(
    'bw',
    'B&W Film',
    'camera-bw',
    'Película en blanco y negro: negros profundos, altas luces plateadas y grano visible.',
    'black-and-white film look: deep blacks, silvery highlights, visible grain, no colour',
  ),
  option(
    'dv',
    'DV Camcorder',
    'camera-dv',
    'Videocámara DV de los noventa: detalle de video blando, altas luces quemadas y color plano.',
    '1990s DV camcorder footage: soft video detail, slightly blown highlights, flat colour',
  ),
  option(
    'vhs',
    'VHS Tape',
    'camera-vhs',
    'Cinta VHS: detalle emborronado, sangrado de color y saturación apagada.',
    'VHS tape look: soft smeared detail, colour bleeding at the edges, muted saturation, light tape noise',
  ),
  option(
    'phone',
    'Smartphone',
    'camera-phone',
    'Teléfono móvil: imagen de gran profundidad de campo, color procesado y pulso ligero.',
    'smartphone footage: deep-focus image, punchy processed colour, a slight handheld sway',
  ),
  option(
    'cctv',
    'Surveillance',
    'camera-cctv',
    'Cámara de vigilancia: vista fija y alta, baja resolución, grano y tono verdoso.',
    'surveillance camera look: fixed high wide view, low resolution, grain, slightly green cast, no on-screen text',
  ),
]);

export const FILM_LENSES = Object.freeze([
  option('auto', 'Auto', 'lens-auto', 'La lente la decide el tamaño del plano (su focal).'),
  option(
    'clean',
    'Clean Sharp',
    'lens-clean',
    'Lentes esféricas modernas: nitidez de borde a borde, color neutro, sin distorsión ni destellos.',
    'clean sharp spherical lenses: crisp edge-to-edge detail, neutral colour, no distortion, no flare',
  ),
  option(
    'anamorphic',
    'Anamorphic',
    'lens-anamorphic',
    'Anamórfica: desenfoque ovalado, trazos azules horizontales sutiles y campo ancho de cine.',
    'anamorphic lenses: oval out-of-focus highlights, subtle horizontal blue lens streaks, a wide cinematic field',
  ),
  option(
    'vintage-anamorphic',
    'Vintage Anamorphic',
    'lens-vintage-anamorphic',
    'Anamórfica antigua: bordes suaves, destellos dorados horizontales y menos contraste.',
    'vintage anamorphic lenses: soft edges, golden horizontal flares, oval swirling bokeh, lower contrast',
  ),
  option(
    'warm-vintage',
    'Warm Vintage',
    'lens-warm',
    'Lentes antiguas cálidas: imagen suave y de bajo contraste, tono ámbar y brillo en las altas luces.',
    'warm vintage prime lenses: soft low-contrast image, amber cast, gentle glow around highlights',
  ),
  option(
    'halation',
    'Halation Vintage',
    'lens-halation',
    'Halación: resplandor rojo anaranjado alrededor de las luces intensas y bordes suaves.',
    'halation vintage lenses: red-orange glow bleeding around bright highlights, soft edges, creamy contrast',
  ),
  option(
    'soft',
    'Soft Diffusion',
    'lens-soft',
    'Filtro de difusión: brillo onírico en las luces, negros levantados y piel suave.',
    'soft diffusion filter: dreamy glow in the highlights, lifted blacks, smooth skin',
  ),
  option(
    'wide',
    'Wide Angle',
    'lens-wide',
    'Gran angular: campo amplio y mucha profundidad entre primer plano y fondo; cámara cerca del sujeto.',
    'wide-angle lens look: expansive field of view, strong foreground-to-background depth, straight verticals, no fisheye distortion, camera close to the subject',
  ),
  option(
    'tele',
    'Telephoto',
    'lens-tele',
    'Teleobjetivo: proporciones naturales, campo estrecho y fondo comprimido; cámara lejos del sujeto.',
    'short-telephoto lens look: natural undistorted proportions, narrow field of view, compressed background, camera farther from the subject',
  ),
  option(
    'macro',
    'Macro',
    'lens-macro',
    'Macro: detalle extremo y un plano de foco finísimo.',
    'macro lens: extreme close detail, paper-thin plane of focus',
  ),
  option(
    'fisheye',
    'Fisheye',
    'lens-fisheye',
    'Ojo de pez: distorsión de barril extrema y bordes curvos.',
    'fisheye lens: strong barrel distortion, ultra-wide curved edges',
  ),
]);

export const FILM_APERTURES = Object.freeze([
  option(
    'auto',
    'Auto',
    'aperture-auto',
    'La apertura y la profundidad de campo las decide el tamaño del plano.',
  ),
  option(
    'f1.4',
    'f/1.4 Ultra Shallow',
    'aperture-f1-4',
    'Profundidad mínima: un plano de foco finísimo y fondo muy difuminado.',
    'aperture f/1.4: razor-thin plane of focus, creamy heavily blurred background',
  ),
  option(
    'f2',
    'f/2 Shallow',
    'aperture-f2',
    'Poca profundidad: sujeto nítido sobre un fondo suave.',
    'aperture f/2: very shallow depth of field, soft blurred background',
  ),
  option(
    'f2.8',
    'f/2.8 Soft Background',
    'aperture-f2-8',
    'Fondo suavemente desenfocado y sujeto bien separado.',
    'aperture f/2.8: shallow depth of field, gently blurred background',
  ),
  option(
    'f4',
    'f/4 Moderate',
    'aperture-f4',
    'Profundidad moderada: sujeto nítido y fondo ligeramente desenfocado.',
    'aperture f/4: moderate depth of field, sharp subject with a softly defocused background',
  ),
  option(
    'f5.6',
    'f/5.6 Balanced',
    'aperture-f5-6',
    'Equilibrada: el sujeto y su entorno cercano, nítidos.',
    'aperture f/5.6: balanced depth of field, subject and nearby surroundings sharp',
  ),
  option(
    'f8',
    'f/8 Sharp',
    'aperture-f8',
    'Profunda: casi toda la escena nítida.',
    'aperture f/8: deep depth of field, most of the scene sharp',
  ),
  option(
    'f11',
    'f/11 Deep Focus',
    'aperture-f11',
    'Foco profundo: del primer plano al horizonte, todo nítido.',
    'aperture f/11: deep focus, everything from foreground to horizon sharp',
  ),
  option(
    'f16',
    'f/16 Everything Sharp',
    'aperture-f16',
    'Todo nítido, incluso el horizonte; las luces puntuales dibujan una estrella sutil.',
    'aperture f/16: everything crisp even at the horizon, a faint starburst on point lights',
  ),
]);

export const FILM_OPTICS_GROUPS = Object.freeze({
  camera: FILM_CAMERAS,
  lens: FILM_LENSES,
  aperture: FILM_APERTURES,
});
export const FILM_OPTICS_KEYS = Object.freeze(Object.keys(FILM_OPTICS_GROUPS));
export const FILM_OPTICS_DEFAULT = Object.freeze({
  camera: 'auto',
  lens: 'auto',
  aperture: 'auto',
  palette: 'auto',
});

/** The optics of a scene of a film document, with "auto" for whatever it does not set. */
export function filmOpticsOf(document, sceneId) {
  return { ...FILM_OPTICS_DEFAULT, ...(document?.optics?.[sceneId] || {}) };
}

/** True when a value is a valid choice of its group. */
export function isFilmOpticsChoice(key, value) {
  return Boolean(FILM_OPTICS_GROUPS[key]?.some((item) => item.id === value));
}

/** The prompt phrase of a choice, empty for "auto". */
export function filmOpticsPhrase(key, value) {
  return FILM_OPTICS_GROUPS[key]?.find((item) => item.id === value)?.phrase || '';
}
