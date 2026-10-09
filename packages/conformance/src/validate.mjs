/**
 * Minimal JSON Schema validator for the gates-spec VSR schema.
 *
 * Deliberately zero-dependency so the conformance suite runs anywhere.
 * Supports exactly the keyword subset the schema uses:
 *   type, required, properties, additionalProperties(false), items,
 *   enum, const, pattern, minimum, minLength, $ref (#/$defs/...)
 */

/**
 * @param {unknown} value
 * @param {any} schema
 * @param {any} [root]
 * @param {string} [path]
 * @returns {string[]} human-readable errors; empty means valid
 */
export function validateInstance(value, schema, root = schema, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (!target) return [`${path}: unresolvable $ref ${schema.$ref}`];
    return validateInstance(value, target, root, path);
  }

  const errs = [];
  const type = schema.type;
  if (type) {
    if (!matchesType(value, type)) {
      errs.push(`${path}: expected type ${type}, got ${describe(value)}`);
      return errs; // no point descending
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errs.push(`${path}: expected constant ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errs.push(`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum.join(', ')}]`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errs.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errs.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errs.push(`${path}: less than minimum ${schema.minimum}`);
    }
  }

  if (type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value);
    for (const req of schema.required ?? []) {
      if (!(req in obj)) errs.push(`${path}.${req}: required but missing`);
    }
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errs.push(...validateInstance(obj[key], sub, root, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errs.push(`${path}.${key}: additional property not allowed`);
      }
    }
  }

  if (type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errs.push(...validateInstance(item, schema.items, root, `${path}[${i}]`));
    });
  }

  return errs;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) return null;
  return ref
    .slice(2)
    .split('/')
    .reduce((acc, seg) => (acc == null ? null : acc[seg]), root);
}

function matchesType(value, type) {
  switch (type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
