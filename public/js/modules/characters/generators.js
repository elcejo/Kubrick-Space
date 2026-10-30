import { escapeHTML } from '../../safe-html.js';

export function getSkinLabel(skin) {
  const map = {
    'muy-clara': 'Muy Clara',
    clara: 'Clara',
    media: 'Media',
    morena: 'Morena',
    oscura: 'Oscura',
  };
  return map[skin] || skin || 'Sin definir';
}

export function getBodyLabel(body) {
  const map = {
    1: 'Muy Delgada',
    2: 'Delgada',
    3: 'Media',
    4: 'Atlética',
    5: 'Robusta',
  };
  return map[body] || body || 'Sin definir';
}

export function getVoiceLabel(voice) {
  const map = {
    'male-deep': 'Masculina profunda',
    'male-warm': 'Masculina cálida',
    'female-soft': 'Femenina suave',
    'female-bright': 'Femenina brillante',
    neutral: 'Neutra',
  };
  return map[voice] || voice || 'Sin definir';
}

export function parseSkinValue(label) {
  const clean = (label || '').trim().toLowerCase();
  const map = {
    'muy clara': 'muy-clara',
    clara: 'clara',
    media: 'media',
    morena: 'morena',
    oscura: 'oscura',
  };
  return map[clean] || 'media';
}

export function parseBodyValue(label) {
  const clean = (label || '').trim().toLowerCase();
  const map = {
    'muy delgada': 1,
    delgada: 2,
    media: 3,
    atlética: 4,
    atletica: 4,
    robusta: 5,
  };
  return map[clean] || 3;
}

export function parseVoiceValue(label) {
  const clean = (label || '').trim().toLowerCase();
  const map = {
    'masculina profunda': 'male-deep',
    'masculina cálida': 'male-warm',
    'masculina calida': 'male-warm',
    'femenina suave': 'female-soft',
    'femenina brillante': 'female-bright',
    neutra: 'neutral',
    neutral: 'neutral',
  };
  return map[clean] || 'neutral';
}

export function generateCharacterInitialContent(projectName, traits) {
  const safeProjectName = escapeHTML(projectName);
  const skinLabel = escapeHTML(getSkinLabel(traits.skin));
  const bodyLabel = escapeHTML(getBodyLabel(traits.body).toString());
  const voiceLabel = escapeHTML(getVoiceLabel(traits.voice));

  const safeAge = escapeHTML(String(traits.age ?? ''));
  const safePitch = escapeHTML(String(traits.pitch ?? ''));
  const safePseudonyms = escapeHTML(traits.pseudonyms || '');
  const safeClothing = escapeHTML(traits.clothing || '');
  const safeLore = escapeHTML(traits.lore || '');
  const safePsychology = escapeHTML(traits.psychology || '');

  return (
    `<h1>${safeProjectName}</h1>\n` +
    `<h2>Edad</h2>\n` +
    `<p><age>${safeAge}</age></p>\n` +
    `<h2>Tonalidad Piel</h2>\n` +
    `<p><skin>${skinLabel}</skin></p>\n` +
    `<h2>Complexión</h2>\n` +
    `<p><complexion>${bodyLabel}</complexion></p>\n` +
    `<h2>Voz</h2>\n` +
    `<p><voice>${voiceLabel}</voice> (Frecuencia: <pitch>${safePitch}</pitch> Hz)</p>\n` +
    `<h2>Pseudónimos</h2>\n` +
    `<p><pseudonyms>${safePseudonyms}</pseudonyms></p>\n` +
    `<h2>Vestimenta</h2>\n` +
    `<p><clothing>${safeClothing}</clothing></p>\n` +
    `<h2>Lore y Trasfondo</h2>\n` +
    `<p><lore>${safeLore}</lore></p>\n` +
    `<h2>Psicología y Personalidad</h2>\n` +
    `<p><psychology>${safePsychology}</psychology></p>`
  );
}

export function generateRandomTraitsForCharacter(projectName) {
  const ages = [18, 20, 24, 25, 28, 30, 32, 35, 40, 45, 50, 60, 70];
  const skins = ['muy-clara', 'clara', 'media', 'morena', 'oscura'];
  const bodies = [1, 2, 3, 4, 5];
  const voices = ['male-deep', 'male-warm', 'female-soft', 'female-bright', 'neutral'];

  const age = ages[Math.floor(Math.random() * ages.length)];
  const skin = skins[Math.floor(Math.random() * skins.length)];
  const body = bodies[Math.floor(Math.random() * bodies.length)];
  const voice = voices[Math.floor(Math.random() * voices.length)];
  const pitch = Math.floor(Math.random() * 80) + 60; // range 60 to 140

  const lores = [
    `Originario de una lejana región fronteriza, ${projectName} creció aprendiendo a sobrevivir en entornos difíciles. Ha dedicado sus últimos años a la investigación y el autodescubrimiento, buscando cambiar el destino de su comunidad.`,
    `Nacido en la vibrante metrópolis futurista, ${projectName} combina un gran ingenio tecnológico con una gran pasión por el arte clásico. Trabaja de forma independiente, resolviendo misterios que otros prefieren ignorar.`,
    `Una figura misteriosa que ha recorrido diversos reinos. Pocos conocen el verdadero origen de ${projectName}, pero se rumorea que custodia un antiguo secreto familiar relacionado con la energía y la luz.`,
    `Desde joven, ${projectName} mostró un talento excepcional para la comunicación y la diplomacia. Tras años de viajar y documentar culturas perdidas, ahora busca compartir sus hallazgos con el mundo.`,
    `Criado en armonía con la naturaleza y las tradiciones ancestrales, ${projectName} actúa como un puente entre el pasado mítico y el caótico presente tecnológico. Su sabiduría suele guiar a quienes lo rodean.`,
  ];

  const psychologies = [
    `De mente perspicaz, observador y extremadamente analítico. Posee una paciencia inquebrantable, pero suele ser reservado con sus emociones personales.`,
    `Carismático, energético y siempre dispuesto a liderar. Tiene una gran intuición para leer a las personas, aunque a veces actúa de manera impulsiva.`,
    `Sereno, comprensivo y con una profunda empatía. Valora la lealtad por encima de todo y prefiere resolver los conflictos mediante el diálogo y la negociación.`,
    `Pragmático, decidido y enfocado en la eficiencia. No se deja distraer por sentimentalismos, aunque posee un fuerte sentido de la justicia.`,
    `Curioso, imaginativo y algo excéntrico. Siempre busca una perspectiva única en cada situación y disfruta desafiando el statu quo.`,
  ];

  const clothings = [
    `Túnica de mago oscuro con bordados rúnicos dorados`,
    `Traje de gala futurista con filamentos de fibra óptica integrados`,
    `Chaqueta de cuero gastada, jeans oscuros y botas de combate de su época militar`,
    `Armadura ligera de cuero tachonado, capa verde bosque y brazaletes de plata`,
    `Ropa informal de explorador: camisa de lino beige, pantalones con múltiples bolsillos y sombrero de ala ancha`,
    `Vestido elegante de seda carmesí con encaje negro y un colgante antiguo de zafiro`,
    `Uniforme militar impecable con medallas al valor y guantes blancos de oficial`,
  ];

  const lore = lores[Math.floor(Math.random() * lores.length)];
  const psychology = psychologies[Math.floor(Math.random() * psychologies.length)];
  const clothing = clothings[Math.floor(Math.random() * clothings.length)];

  return {
    age,
    skin,
    body,
    voice,
    pitch,
    pseudonyms: '',
    lore,
    psychology,
    clothing,
  };
}
