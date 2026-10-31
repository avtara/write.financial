// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Models asked to "return only JSON" still answer in varying envelopes: bare JSON, one Markdown fence
 * (` ```json … ``` `), or prose around the object. Only the envelope is tolerated here; every field stays the
 * caller's strict validation, and bounding the input length stays the caller's job.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The end (exclusive) of the balanced object opening at `start`, skipping braces inside JSON strings; -1 if unclosed. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index + 1;
  }
  return -1;
}

/**
 * The single top-level JSON object of a model answer. A bare answer must itself be an object (an array or scalar is
 * refused, never searched); otherwise the first `{` and its balanced `}` are taken, which covers a fence and prose
 * alike. A second object afterwards, or one nested in an array, is ambiguous and refused rather than guessed.
 */
export function parseModelJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  let bare: unknown;
  try {
    bare = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = start === -1 ? -1 : objectEnd(trimmed, start);
    if (end === -1 || trimmed.slice(0, start).trimEnd().endsWith('[') || trimmed.includes('{', end))
      throw new Error('Model JSON rejected');
    const value: unknown = JSON.parse(trimmed.slice(start, end));
    if (!isObject(value)) throw new Error('Model JSON rejected');
    return value;
  }
  if (!isObject(bare)) throw new Error('Model JSON rejected');
  return bare;
}

/**
 * Models often emit minor units as a JSON integer despite the "decimal string" instruction. A non-negative safe
 * integer becomes its exact decimal string; anything else (float, negative, unsafe, string, null) passes through
 * unchanged for the caller's strict validation.
 */
export function modelMinorUnits(value: unknown): unknown {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
}
