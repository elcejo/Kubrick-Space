/**
 * The inline operations a model may use on the text of a Story Book or a screenplay, the ones the editor's toolbar gives a
 * person: format a piece of text, make it one of the author's terms (with its definition) and protect it. A piece of text is
 * named by itself, exactly as it is written in the element, never by position and never as HTML.
 *
 * These definitions are shared by the schemas of both kinds; each spreads them into its own `$defs`.
 */
const text = (max, extra = {}) => ({ type: 'string', maxLength: max, ...extra });
const NOT_EMPTY = Object.freeze({ minLength: 1 });
const COLOR = {
  type: ['string', 'null'],
  pattern: '^#[0-9a-fA-F]{6}$',
  'x-hint': 'El color es hexadecimal (#22d3ee); null lo quita.',
};
const op = (name, properties, required = []) => ({
  type: 'object',
  required: ['op', 'id', 'text', ...required],
  additionalProperties: false,
  properties: {
    op: { const: name },
    id: { $ref: '#/$defs/Id' },
    text: text(400, NOT_EMPTY),
    ...properties,
  },
});
const OCCURRENCE = {
  enum: ['first', 'all'],
  'x-hint':
    'first (por omisión) actúa sobre la primera aparición del texto en el elemento; all, sobre todas.',
};

export const INLINE_OPERATION_NAMES = Object.freeze([
  'format_text',
  'tag_term',
  'untag_term',
  'protect_text',
  'unprotect_text',
]);
export const INLINE_BRANCHES = Object.freeze([
  'FormatText',
  'TagTerm',
  'UntagTerm',
  'ProtectText',
  'UnprotectText',
]);

export function inlineDefinitions() {
  return {
    FormatText: op('format_text', {
      occurrence: OCCURRENCE,
      bold: { type: 'boolean' },
      italic: { type: 'boolean' },
      underline: { type: 'boolean' },
      strike: { type: 'boolean' },
      color: COLOR,
      highlight: COLOR,
    }),
    TagTerm: op('tag_term', { occurrence: OCCURRENCE, definition: text(1000, NOT_EMPTY) }, ['definition']),
    UntagTerm: op('untag_term', {}),
    ProtectText: op('protect_text', { occurrence: OCCURRENCE }),
    UnprotectText: op('unprotect_text', {}),
  };
}
