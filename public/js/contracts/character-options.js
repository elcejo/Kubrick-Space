import {
  validateCharacterDocument,
  changeCharacterIdentity,
  newCharacterFieldId,
} from './character-model.js';

// Curated starting points, never an exhaustive taxonomy or automatically selected facts.
export const CHARACTER_NATURES = Object.freeze({
  humanoid: ['Humano', 'Elfo', 'Orco', 'Alienígena', 'Androide', 'Hada'],
  animal: ['Gato', 'Perro', 'Ave', 'Roedor', 'Reptil', 'Anfibio', 'Insecto', 'Pez'],
  object: ['Juguete', 'Utensilio', 'Robot', 'Vehículo', 'Planta'],
  entity: ['Fantasma', 'Elemental', 'Sombra', 'Energía', 'Holograma'],
  hybrid: ['Animal antropomorfo', 'Quimera', 'Cíborg', 'Criatura vegetal'],
});
const choices = (labels, icon = 'option-person') =>
  labels.map((label, i) => ({ id: String(i), label, value: label, icon }));
const group = (id, label, labels, icon, extra = {}) => ({
  id,
  key: `custom.design_${id}`,
  label,
  choices: choices(labels, icon),
  type: 'select',
  ...extra,
});
const colors = (id, label, values) =>
  group(id, label, [], null, {
    type: 'color',
    choices: values.map(([name, hex], i) => ({ id: String(i), label: name, value: hex, color: hex })),
  });
const hairColors = [
  ['Negro', '#171414'],
  ['Castaño oscuro', '#3e2c23'],
  ['Castaño', '#86543b'],
  ['Cobrizo', '#b86636'],
  ['Rojo', '#a93742'],
  ['Rubio', '#d5b773'],
  ['Platino', '#e4dac1'],
  ['Gris', '#90949c'],
  ['Blanco', '#eee9de'],
  ['Rosa', '#dc99bc'],
  ['Lila', '#a995cf'],
  ['Azul', '#477ea9'],
  ['Verde', '#537f63'],
];
const common = () => [
  group(
    'style',
    'Tratamiento visual',
    ['Natural', 'Estilizado', 'Fantástico', 'Animación 3D', 'Ilustrado'],
    'option-style',
  ),
  group('age', 'Etapa vital', ['Joven', 'Adulto', 'Maduro', 'Anciano'], 'option-age'),
  group('size', 'Tamaño', ['Pequeño', 'Mediano', 'Grande', 'Gigante'], 'option-scale'),
  group(
    'accessories',
    'Accesorios',
    ['Sin accesorios', 'Gafas', 'Sombrero', 'Collar', 'Mochila', 'Auriculares'],
    'option-accessory',
    { multiple: true },
  ),
];

export function characterOptionGroups(base, nature) {
  if (!CHARACTER_NATURES[base]?.includes(nature)) return [];
  if (base === 'humanoid')
    return [
      group(
        'stylization',
        'Tipo de personaje',
        ['Común (Average)', 'Expresivo', 'Exagerado'],
        'option-person',
      ),
      group(
        'gender',
        'Género',
        ['Mujer', 'Hombre', 'Hombre trans', 'Mujer trans', 'No binario'],
        'option-gender',
      ),
      group(
        'build',
        'Complexión',
        ['Delgada', 'Esbelta', 'Media', 'Curvilínea', 'Corpulenta', 'Musculosa'],
        'option-build',
        { key: 'human.build', type: 'text' },
      ),
      group(
        'hair',
        'Peinado',
        [
          'Sin cabello',
          'Corto',
          'Bob',
          'Ondulado',
          'Trenzas',
          'Coletas',
          'Afro',
          'Cresta',
          'Largo y liso',
          'Rapado',
        ],
        'option-hair',
        { key: 'human.hair', type: 'text' },
      ),
      colors('hair_color', 'Color de cabello', hairColors),
      group(
        'wardrobe',
        'Vestimenta',
        ['Retro', 'Deportiva', 'Romántica', 'Fantasía medieval', 'Gótica', 'Formal', 'Urbana', 'Casual'],
        'option-wardrobe',
        { key: 'human.clothing', type: 'multiline' },
      ),
      group(
        'ancestry',
        'Ascendencia declarada',
        [
          'Africana',
          'Asiática oriental',
          'Europea',
          'Sudasiática',
          'Medio oriental',
          'Latinoamericana',
          'Mixta',
        ],
        'option-ancestry',
      ),
      ...common().filter((item) => !['accessories', 'size'].includes(item.id)),
      colors('skin_color', 'Color de piel', [
        ['Porcelana', '#f3e2d2'],
        ['Clara', '#e7c5af'],
        ['Media', '#cda081'],
        ['Oliva', '#b89a70'],
        ['Bronceada', '#ae8057'],
        ['Morena', '#865a3d'],
        ['Oscura', '#563925'],
        ['Muy oscura', '#30231e'],
        ['Fantástica', '#9ba8db'],
      ]),
      group('height', 'Estatura', ['Baja', 'Media', 'Alta'], 'option-height'),
      group(
        'proportions',
        'Proporciones',
        ['Equilibradas', 'Compactas', 'Alargadas', 'Caricaturescas'],
        'option-proportions',
      ),
      group(
        'head',
        'Forma del rostro',
        ['Ovalado', 'Redondo', 'Cuadrado', 'Alargado', 'Corazón'],
        'option-face',
      ),
      group('neck', 'Cuello', ['Corto', 'Medio', 'Largo'], 'option-neck'),
      group(
        'eyes',
        'Forma de ojos',
        ['Almendrados', 'Redondos', 'Monólidos', 'Ascendentes', 'Descendentes', 'Encapotados', 'Profundos'],
        'option-eye',
        { key: 'human.eyes', type: 'text' },
      ),
      colors('eye_color', 'Color de ojos', [
        ['Negro', '#191614'],
        ['Marrón', '#6c482f'],
        ['Avellana', '#8c7d46'],
        ['Verde', '#668557'],
        ['Azul', '#5487a3'],
        ['Azul hielo', '#acd4db'],
        ['Ámbar', '#ba8b3d'],
        ['Gris', '#9ba5a7'],
      ]),
      group(
        'features',
        'Rasgos faciales',
        [
          'Pecas',
          'Hoyuelos',
          'Ojeras',
          'Pómulos marcados',
          'Labios carnosos',
          'Cejas pobladas',
          'Nariz recta',
          'Nariz ancha',
          'Mandíbula suave',
          'Mandíbula marcada',
        ],
        'option-features',
        { multiple: true },
      ),
      group(
        'beard',
        'Vello facial',
        ['Sin barba', 'Barba corta', 'Barba larga', 'Perilla', 'Bigote', 'Patillas'],
        'option-beard',
      ),
      group(
        'distinctive',
        'Detalles distintivos',
        [
          'Cicatriz',
          'Tatuaje',
          'Piercing',
          'Vitíligo',
          'Heterocromía',
          'Lunar',
          'Diente separado',
          'Brackets',
          'Maquillaje',
          'Orejas puntiagudas',
        ],
        'option-detail',
        { multiple: true },
      ),
      ...common().filter((item) => item.id === 'accessories'),
      ...(nature === 'Humano'
        ? []
        : [
            group(
              'anatomy',
              'Anatomía de la especie',
              nature === 'Elfo' || nature === 'Hada'
                ? ['Orejas puntiagudas', 'Rasgos etéreos', 'Alas translúcidas']
                : nature === 'Orco'
                  ? ['Colmillos', 'Piel rugosa', 'Mandíbula prominente']
                  : nature === 'Androide'
                    ? ['Carcasa lisa', 'Juntas mecánicas', 'Circuitos visibles']
                    : ['Antenas', 'Ojos múltiples', 'Piel luminosa'],
              nature === 'Elfo' || nature === 'Hada'
                ? 'option-anatomy-fae'
                : nature === 'Orco'
                  ? 'option-anatomy-orc'
                  : nature === 'Androide'
                    ? 'option-anatomy-android'
                    : 'option-anatomy-alien',
              { multiple: true },
            ),
          ]),
    ];
  if (base === 'animal' || (base === 'hybrid' && nature === 'Animal antropomorfo')) {
    const bird = nature === 'Ave',
      insect = nature === 'Insecto',
      reptile = ['Reptil', 'Pez', 'Anfibio'].includes(nature);
    return [
      ...common(),
      group(
        'coat',
        bird ? 'Plumaje' : insect ? 'Exoesqueleto' : reptile ? 'Cubierta' : 'Pelaje',
        bird
          ? ['Liso', 'Cresta', 'Plumas largas', 'Plumón']
          : insect
            ? ['Liso', 'Segmentado', 'Brillante', 'Espinoso']
            : reptile
              ? ['Escamas lisas', 'Escamas rugosas', 'Piel húmeda', 'Traslúcida']
              : ['Corto', 'Largo', 'Rizado', 'Sin pelo'],
        `option-coat-${bird ? 'bird' : insect ? 'insect' : reptile ? 'fish' : 'mammal'}`,
        { key: base === 'animal' ? 'animal.coat' : 'custom.design_coat', type: 'text' },
      ),
      colors('coat_color', 'Color de cubierta', hairColors),
      group(
        'pattern',
        'Patrón',
        ['Sólido', 'Manchas', 'Rayas', 'Moteado', 'Bicolor', 'Degradado'],
        'option-pattern',
      ),
      group(
        'anatomy',
        'Anatomía',
        bird
          ? ['Pico corto', 'Pico largo', 'Alas amplias', 'Cola larga']
          : insect
            ? ['Antenas largas', 'Alas transparentes', 'Seis patas', 'Mandíbulas grandes']
            : nature === 'Pez'
              ? ['Aletas amplias', 'Cola de abanico', 'Cuerpo alargado', 'Branquias visibles']
              : ['Orejas redondas', 'Orejas puntiagudas', 'Cola larga', 'Patas cortas'],
        `option-anatomy-${bird ? 'bird' : insect ? 'insect' : nature === 'Pez' ? 'fish' : 'mammal'}`,
        { multiple: true },
      ),
      group(
        'temperament',
        'Temperamento',
        ['Tranquilo', 'Curioso', 'Juguetón', 'Reservado', 'Enérgico', 'Protector'],
        'option-temperament',
        {
          key: base === 'animal' ? 'animal.temperament' : 'custom.design_temperament',
          type: 'text',
          section: 'performance',
        },
      ),
    ];
  }
  if (base === 'object')
    return [
      ...common().filter((item) => item.id !== 'age'),
      group(
        'material',
        'Material',
        nature === 'Planta'
          ? ['Hojas', 'Corteza', 'Flores', 'Musgo']
          : nature === 'Robot'
            ? ['Metal', 'Cerámica', 'Plástico', 'Fibra de carbono']
            : ['Madera', 'Metal', 'Plástico', 'Vidrio', 'Cerámica', 'Tela'],
        nature === 'Planta'
          ? 'option-plant-material'
          : nature === 'Robot'
            ? 'option-robot-material'
            : 'option-object',
      ),
      colors('surface_color', 'Color principal', hairColors),
      group(
        'surface',
        'Acabado',
        ['Mate', 'Brillante', 'Desgastado', 'Oxidado', 'Transparente'],
        'option-finish',
      ),
      group(
        'face',
        'Expresión',
        ['Sin rostro', 'Ojos y boca', 'Ojos grandes', 'Rostro integrado'],
        'option-object-face',
      ),
      group(
        'limbs',
        'Movimiento',
        ['Sin extremidades', 'Brazos y piernas', 'Ruedas', 'Flotación', 'Tentáculos'],
        'option-motion',
      ),
    ];
  if (base === 'entity')
    return [
      ...common().filter((item) => item.id !== 'age'),
      group(
        'form',
        'Forma',
        ['Silueta humanoide', 'Nube', 'Esfera', 'Forma abstracta', 'Silueta animal'],
        'option-entity',
      ),
      group(
        'substance',
        'Sustancia',
        nature === 'Elemental'
          ? ['Fuego', 'Agua', 'Tierra', 'Aire', 'Hielo']
          : nature === 'Sombra'
            ? ['Oscuridad', 'Humo', 'Vacío']
            : ['Niebla', 'Luz', 'Energía', 'Partículas'],
        nature === 'Elemental' ? 'option-element' : nature === 'Sombra' ? 'option-shadow' : 'option-mist',
      ),
      colors('glow', 'Color de aura', hairColors),
      group('opacity', 'Presencia', ['Sólida', 'Translúcida', 'Etérea', 'Intermitente'], 'option-opacity'),
      group('movement', 'Movimiento', ['Flota', 'Se desliza', 'Camina', 'Se dispersa'], 'option-drift'),
    ];
  return [
    ...common(),
    group(
      'components',
      'Componentes',
      nature === 'Cíborg'
        ? ['Orgánico y metal', 'Prótesis visibles', 'Implantes discretos']
        : nature === 'Criatura vegetal'
          ? ['Hojas', 'Raíces', 'Flores', 'Corteza']
          : ['Rasgos felinos', 'Rasgos de ave', 'Rasgos reptilianos', 'Rasgos humanos'],
      nature === 'Cíborg'
        ? 'option-cyborg'
        : nature === 'Criatura vegetal'
          ? 'option-vegetal'
          : 'option-hybrid',
      { multiple: true },
    ),
    colors('surface_color', 'Color principal', hairColors),
    group(
      'covering',
      'Cubierta',
      ['Piel', 'Pelaje', 'Escamas', 'Plumas', 'Metal', 'Corteza'],
      'option-covering',
    ),
    group(
      'distinctive',
      'Anatomía distintiva',
      ['Alas', 'Cuernos', 'Cola', 'Brazos adicionales', 'Ojos múltiples'],
      'option-hybrid-detail',
      { multiple: true },
    ),
  ];
}

export function selectCharacterNature(document, base, nature) {
  if (!CHARACTER_NATURES[base]?.includes(nature)) throw new Error('Naturaleza no disponible para esta base.');
  return changeCharacterIdentity(document, base, nature);
}

export function applyCharacterOption(document, groupId, choiceId, { toggle = true } = {}) {
  const next = validateCharacterDocument(document);
  const spec = characterOptionGroups(next.identity.base, next.identity.nature).find(
    (item) => item.id === groupId,
  );
  const choice = spec?.choices.find((item) => item.id === choiceId);
  if (!choice) throw new Error('Opción de personaje inválida.');
  let field = next.fields.find((item) => item.key === spec.key);
  if (!field) {
    field = {
      id: newCharacterFieldId(),
      key: spec.key,
      label: spec.label,
      type: spec.multiple ? 'multiline' : spec.type,
      section: spec.section || 'appearance',
      value: null,
      options: spec.type === 'select' ? spec.choices.map((item) => item.value) : [],
      required: false,
      origin: 'user',
      explicit: false,
    };
    next.fields.push(field);
  }
  if (spec.multiple) {
    const values = new Set(
      String(field.value || '')
        .split('; ')
        .filter(Boolean),
    );
    if (values.has(choice.value) && toggle) values.delete(choice.value);
    else {
      if (/^Sin /.test(choice.value)) values.clear();
      else for (const value of values) if (/^Sin /.test(value)) values.delete(value);
      values.add(choice.value);
    }
    field.value = [...values].join('; ') || null;
  } else field.value = toggle && field.value === choice.value ? null : choice.value;
  field.origin = 'user';
  next.revision++;
  return validateCharacterDocument(next);
}
