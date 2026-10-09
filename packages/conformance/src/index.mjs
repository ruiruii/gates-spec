/**
 * Combined conformance entry point: JSON Schema validation + semantic verification.
 */

import { readFileSync } from 'node:fs';
import { validateInstance } from './validate.mjs';
import { verifyVSR, toSpanAttributes } from '@gates-spec/core';

const SCHEMA_URL = new URL('../../../schema/vsr-v0.1.schema.json', import.meta.url);

/** Load the bundled VSR JSON Schema. */
export function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));
}

/**
 * Full conformance check of a VSR envelope.
 * @param {unknown} envelope
 * @returns {{
 *   valid: boolean,
 *   schemaValid: boolean,
 *   signatureValid: boolean,
 *   level: string,
 *   schemaErrors: string[],
 *   semanticErrors: string[],
 *   warnings: string[],
 *   spanAttributes: Record<string, unknown>
 * }}
 */
export function checkEnvelope(envelope) {
  const schema = loadSchema();
  const schemaErrors = validateInstance(envelope, schema);
  const semantic = verifyVSR(envelope);

  const signatureValid =
    !semantic.errors.some((e) => e.startsWith('signature')) &&
    typeof /** @type {any} */ (envelope)?.signature === 'string';

  return {
    valid: schemaErrors.length === 0 && semantic.valid,
    schemaValid: schemaErrors.length === 0,
    signatureValid,
    level: semantic.level,
    schemaErrors,
    semanticErrors: semantic.errors,
    warnings: semantic.warnings,
    spanAttributes: envelope && typeof envelope === 'object' && 'vsr' in envelope
      ? toSpanAttributes(/** @type {any} */ (envelope).vsr)
      : {},
  };
}

export { validateInstance, verifyVSR, toSpanAttributes };
