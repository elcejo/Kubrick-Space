/**
 * A small, dependency-free validator for the subset of JSON Schema that Kubrick Space's operation schemas use.
 * It does not coerce or repair anything: it reports every place where a value leaves its schema, in Spanish and with
 * the exact path, so that a model that strayed can be told precisely what to fix.
 *
 * Supported: $ref to #/$defs, type (also a list), enum, const, required, properties, additionalProperties (false or a
 * schema), items, minItems, maxItems, minLength, maxLength, minimum, maximum, multipleOf, pattern, anyOf, oneOf.
 */
const typeOf = (value) =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : Number.isInteger(value)
        ? 'integer'
        : typeof value;
const TYPE_NAMES = Object.freeze({
  string: 'texto',
  number: 'número',
  integer: 'número entero',
  boolean: 'verdadero o falso',
  object: 'objeto',
  array: 'lista',
  null: 'nulo',
});
const matchesType = (value, type) =>
  type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeOf(value) === type;
const show = (value) => (typeof value === 'string' ? '«' + value + '»' : JSON.stringify(value));
const where = (path) => path || 'la raíz';

function resolve(schema, root) {
  let current = schema;
  for (let depth = 0; current?.$ref && depth < 16; depth++) {
    const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(current.$ref);
    const target = match && root.$defs?.[match[1]];
    if (!target) throw new Error('Referencia de esquema desconocida: ' + current.$ref);
    current = target;
  }
  return current;
}
/** The value a property fixes: its const, or the only value its enum allows. */
const fixedValue = (property) =>
  property?.const !== undefined
    ? property.const
    : Array.isArray(property?.enum) && property.enum.length === 1
      ? property.enum[0]
      : undefined;
/** The property every branch of a oneOf fixes with const, when there is one: it says which branch applies. */
function discriminator(branches, root) {
  const resolved = branches.map((branch) => resolve(branch, root));
  const keys = Object.keys(resolved[0]?.properties || {}).filter((key) => {
    const values = resolved.map((branch) => fixedValue(branch.properties?.[key]));
    // A property tells the branches apart only if each fixes a value and no two fix the same one.
    return values.every((value) => value !== undefined) && new Set(values.map(String)).size === values.length;
  });
  return keys[0] || null;
}

/**
 * The branch that explains a failure best: the one whose fixed properties (op, id…) the value already matches, and among
 * those the one that fails on the fewest points.
 */
function closest(attempts, branches, value, root) {
  const matches = branches.map((branch) => {
    const properties = resolve(branch, root).properties || {};
    return Object.entries(properties).filter(
      ([key, property]) =>
        fixedValue(property) !== undefined &&
        value &&
        typeof value === 'object' &&
        fixedValue(property) === value[key],
    ).length;
  });
  let best = 0;
  attempts.forEach((list, index) => {
    if (
      matches[index] > matches[best] ||
      (matches[index] === matches[best] && list.length < attempts[best].length)
    )
      best = index;
  });
  return attempts[best];
}

export function validateSchema(value, schema, root = schema, path = '') {
  const node = resolve(schema, root);
  const errors = [];
  const hint = node['x-hint'];
  const fail = (message) => errors.push({ path, message, ...(hint ? { hint } : {}) });
  if (node.const !== undefined && JSON.stringify(value) !== JSON.stringify(node.const)) {
    fail('debe ser ' + show(node.const));
    return errors;
  }
  if (node.enum && !node.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    fail('debe ser uno de ' + node.enum.map(show).join(', ') + ' y es ' + show(value));
    return errors;
  }
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => matchesType(value, type))) {
      fail(
        'debe ser ' +
          types.map((type) => TYPE_NAMES[type] || type).join(' o ') +
          ' y es ' +
          (TYPE_NAMES[typeOf(value)] || typeOf(value)),
      );
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength)
      fail(
        node.minLength === 1 ? 'no puede estar vacío' : 'necesita al menos ' + node.minLength + ' caracteres',
      );
    if (node.maxLength !== undefined && value.length > node.maxLength)
      fail('admite hasta ' + node.maxLength + ' caracteres y tiene ' + value.length);
    if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) fail('no tiene el formato esperado');
  }
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum)
      fail('debe ser al menos ' + node.minimum + ' y es ' + value);
    if (node.maximum !== undefined && value > node.maximum)
      fail('debe ser como máximo ' + node.maximum + ' y es ' + value);
    if (
      node.multipleOf !== undefined &&
      Math.abs(value / node.multipleOf - Math.round(value / node.multipleOf)) > 1e-9
    )
      fail('debe ser múltiplo de ' + node.multipleOf + ' y es ' + value);
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems)
      fail(
        node.minItems === 1
          ? 'necesita al menos un elemento'
          : 'necesita al menos ' + node.minItems + ' elementos',
      );
    if (node.maxItems !== undefined && value.length > node.maxItems)
      fail('admite hasta ' + node.maxItems + ' elementos y tiene ' + value.length);
    if (node.items)
      value.forEach((item, index) =>
        errors.push(...validateSchema(item, node.items, root, path + '[' + index + ']')),
      );
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required || []) {
      if (Object.hasOwn(value, key)) continue;
      const need = node.properties?.[key] && resolve(node.properties[key], root)['x-hint'];
      errors.push({ path: path ? path + '.' + key : key, message: 'falta', ...(need ? { hint: need } : {}) });
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? path + '.' + key : key;
      if (node.properties && Object.hasOwn(node.properties, key))
        errors.push(...validateSchema(child, node.properties[key], root, childPath));
      else if (node.additionalProperties === false)
        errors.push({ path: childPath, message: 'no existe en este formato; quítalo' });
      else if (node.additionalProperties && typeof node.additionalProperties === 'object')
        errors.push(...validateSchema(child, node.additionalProperties, root, childPath));
    }
  }
  const tagged = node.anyOf && value && typeof value === 'object' ? discriminator(node.anyOf, root) : null;
  if (tagged) {
    // Branches told apart by a fixed property (the operation name): name the property, then judge the right branch.
    const branch = node.anyOf.find(
      (item) => fixedValue(resolve(item, root).properties[tagged]) === value[tagged],
    );
    if (!branch)
      errors.push({
        path: path ? path + '.' + tagged : tagged,
        message:
          'debe ser uno de ' +
          node.anyOf.map((item) => show(fixedValue(resolve(item, root).properties[tagged]))).join(', ') +
          ' y es ' +
          show(value[tagged]),
      });
    else errors.push(...validateSchema(value, branch, root, path));
  } else if (node.anyOf) {
    const attempts = node.anyOf.map((branch) => validateSchema(value, branch, root, path));
    if (!attempts.some((list) => !list.length)) {
      // The closest branch explains best: the one that fails on the fewest points.
      const best = closest(attempts, node.anyOf, value, root);
      const reported = best.length ? best : [{ path, message: 'no cumple ninguna de las formas admitidas' }];
      errors.push(
        ...reported.map((error, index) => (index === 0 && hint && !error.hint ? { ...error, hint } : error)),
      );
    }
  }
  if (node.oneOf) {
    const key = discriminator(node.oneOf, root);
    if (key && value && typeof value === 'object') {
      const branch = node.oneOf.find(
        (item) => fixedValue(resolve(item, root).properties[key]) === value[key],
      );
      if (!branch)
        errors.push({
          path: path ? path + '.' + key : key,
          message:
            'debe ser uno de ' +
            node.oneOf.map((item) => show(fixedValue(resolve(item, root).properties[key]))).join(', ') +
            ' y es ' +
            show(value[key]),
        });
      else errors.push(...validateSchema(value, branch, root, path));
    } else {
      const attempts = node.oneOf.map((branch) => validateSchema(value, branch, root, path));
      const passing = attempts.filter((list) => !list.length);
      if (passing.length > 1) fail('debe cumplir exactamente una de las formas admitidas');
      else if (!passing.length) {
        // No branch fits: the closest one (fewest points of failure) explains best, with the hint of the whole.
        const best = closest(attempts, node.oneOf, value, root);
        errors.push(
          ...best.map((error, index) => (index === 0 && hint && !error.hint ? { ...error, hint } : error)),
        );
      }
    }
  }
  return errors;
}

/**
 * A copy of the value without the properties its schema does not declare (where it forbids extra ones), and the paths
 * that were dropped. A field outside the format never reaches a document, whether it is refused or discarded.
 */
export function pruneUndeclared(value, schema, root = schema, path = '') {
  const node = resolve(schema, root);
  const removed = [];
  const visit = (current, branch, at) => {
    const spec = resolve(branch, root);
    if (Array.isArray(current)) {
      if (!spec.items) return current;
      return current.map((item, index) => {
        const out = visit(item, spec.items, at + '[' + index + ']');
        return out;
      });
    }
    if (!current || typeof current !== 'object') return current;
    let target = spec;
    if (spec.oneOf || spec.anyOf) {
      const branches = spec.oneOf || spec.anyOf;
      const key = discriminator(branches, root);
      const picked = key
        ? branches.find((item) => fixedValue(resolve(item, root).properties[key]) === current[key])
        : null;
      if (picked) target = resolve(picked, root);
      else return current;
    }
    const out = {};
    for (const [key, child] of Object.entries(current)) {
      const childAt = at ? at + '.' + key : key;
      if (target.properties && Object.hasOwn(target.properties, key))
        out[key] = visit(child, target.properties[key], childAt);
      else if (target.additionalProperties === false) removed.push(childAt);
      else if (target.additionalProperties && typeof target.additionalProperties === 'object')
        out[key] = visit(child, target.additionalProperties, childAt);
      else out[key] = child;
    }
    return out;
  };
  return { value: visit(value, node, path), removed };
}

/** The errors as lines a person or a model can act on, the first ones only. */
export function explainSchemaErrors(errors, { limit = 8 } = {}) {
  const lines = errors
    .slice(0, limit)
    .map(
      (error) => '- ' + where(error.path) + ': ' + error.message + '.' + (error.hint ? ' ' + error.hint : ''),
    );
  if (errors.length > limit) lines.push('- … y ' + (errors.length - limit) + ' errores más.');
  return lines.join('\n');
}
