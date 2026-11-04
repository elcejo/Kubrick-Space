import { validateSchema, explainSchemaErrors, pruneUndeclared } from './json-schema.js';

/**
 * What a model returns through a tool (its arguments are a JSON text) checked against the very schema the tool
 * declared: parsed, stripped of the fields the schema does not have, validated, and explained with exact paths.
 * Every place where a model hands data to Kubrick Space goes through this, so the declared schema and the checked one
 * are the same thing.
 */
export function checkToolArguments(parameters, raw) {
  let value;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        value: undefined,
        removed: [],
        problems: [{ path: '', message: 'no es JSON válido' }],
        text: '- la raíz: no es JSON válido; devuelve un único objeto JSON.',
      };
    }
  } else value = raw;
  const cleaned = pruneUndeclared(value, parameters);
  const problems = validateSchema(cleaned.value, parameters);
  return {
    value: cleaned.value,
    removed: cleaned.removed,
    problems,
    text: explainSchemaErrors(problems),
  };
}

/** The message that goes back to the model after a call that did not respect its schema. */
export const toolCorrection = (text) =>
  'La respuesta no se aplicó. Corrige solo lo indicado y vuelve a llamar a la herramienta con JSON válido. ' +
  String(text).slice(0, 1500);

export { explainSchemaErrors };
