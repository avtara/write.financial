// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Message catalog checks (PRD D26): every key exists in every locale with the same placeholders and
 * non-empty text, and, on request, every key is used somewhere in the app sources.
 *
 * Catalogs use the inlang message format: a flat object of `snake_case` keys whose values are either a
 * pattern string (`"{count: number} transaksi"`) or an array of variant objects with `declarations`,
 * `selectors`, and a `match` map of patterns.
 */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LOCALES } from './locale.ts';
import type { Locale } from './locale.ts';

/** Message files, relative to the repository root. */
export const MESSAGES_DIR = 'packages/i18n/messages';

/** Where unused-key detection looks for message usage, relative to the repository root. */
export const SOURCE_GLOBS: readonly string[] = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'];

/** A parsed `messages/<locale>.json` file. */
export type Catalog = Readonly<Record<string, unknown>>;

export type CatalogProblem =
  | { kind: 'missing'; key: string; locale: Locale }
  | { kind: 'invalid'; key: string; locale: Locale }
  | { kind: 'empty'; key: string; locale: Locale }
  | { kind: 'placeholders'; key: string; placeholders: Readonly<Record<Locale, readonly string[]>> };

interface ParsedMessage {
  patterns: string[];
  placeholders: string[];
}

/** JSON Schema reference at the top of each catalog; not a message. */
const SCHEMA_KEY = '$schema';

/** Every message key of every locale, sorted, without the `$schema` entry. */
export function messageKeys(catalogs: Readonly<Record<Locale, Catalog>>): string[] {
  const keys = LOCALES.flatMap((locale) => Object.keys(catalogs[locale]));
  return [...new Set(keys)].filter((key) => key !== SCHEMA_KEY).sort();
}

/**
 * Variables referenced by one `{…}` expression or declaration right-hand side: the operand
 * (`count` in `count: number`) and option values (`$currency`). Markup (`#b`, `/b`) and quoted
 * literals (`|text|`) reference none.
 */
function variablesIn(expression: string): string[] {
  const text = expression.replace(/\|(?:\\.|[^|\\])*\|/g, '').trim();
  const operand = /^\$?([A-Za-z_]\w*)/.exec(text)?.[1];
  const options = [...text.matchAll(/\$([A-Za-z_]\w*)/g)].map((match) => match[1] as string);
  return operand === undefined ? options : [operand, ...options];
}

function variablesInPattern(pattern: string): string[] {
  const unescaped = pattern.replace(/\\./g, '');
  return [...unescaped.matchAll(/\{([^}]*)\}/g)].flatMap((match) => variablesIn(match[1] as string));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Parses one catalog value; `null` when it is neither a pattern string nor a list of variant objects. */
function parseMessage(value: unknown): ParsedMessage | null {
  if (typeof value === 'string') return { patterns: [value], placeholders: [...new Set(variablesInPattern(value))] };
  if (!Array.isArray(value) || value.length === 0) return null;
  const patterns: string[] = [];
  const referenced: string[] = [];
  const locals = new Set<string>();
  for (const variant of value as unknown[]) {
    if (typeof variant !== 'object' || variant === null) return null;
    const { declarations = [], selectors = [], match } = variant as Record<string, unknown>;
    if (!isStringArray(declarations) || !isStringArray(selectors)) return null;
    if (typeof match !== 'object' || match === null) return null;
    const variantPatterns = Object.values(match);
    if (variantPatterns.length === 0 || !isStringArray(variantPatterns)) return null;
    for (const declaration of declarations) {
      const parsed = /^(?:input\s+(\w+)|local\s+(\w+)\s*=\s*(.+))$/.exec(declaration.trim());
      if (!parsed) return null;
      const [, input, local, expression] = parsed;
      if (input !== undefined) referenced.push(input);
      if (local !== undefined) locals.add(local);
      if (expression !== undefined) referenced.push(...variablesIn(expression));
    }
    referenced.push(...selectors, ...variantPatterns.flatMap(variablesInPattern));
    patterns.push(...variantPatterns);
  }
  return { patterns, placeholders: [...new Set(referenced.filter((name) => !locals.has(name)))] };
}

/**
 * Compares the catalogs of all locales. Reports keys missing from a locale, values that are not valid
 * messages, messages with an empty pattern, and keys whose placeholders differ between locales.
 */
export function checkCatalogs(catalogs: Readonly<Record<Locale, Catalog>>): CatalogProblem[] {
  const keys = messageKeys(catalogs);
  const problems: CatalogProblem[] = [];
  for (const key of keys) {
    const placeholders: Partial<Record<Locale, string[]>> = {};
    for (const locale of LOCALES) {
      if (!Object.hasOwn(catalogs[locale], key)) {
        problems.push({ kind: 'missing', key, locale });
        continue;
      }
      const message = parseMessage(catalogs[locale][key]);
      if (!message) {
        problems.push({ kind: 'invalid', key, locale });
        continue;
      }
      if (message.patterns.some((pattern) => pattern.trim() === '')) problems.push({ kind: 'empty', key, locale });
      placeholders[locale] = message.placeholders.sort();
    }
    const sets = LOCALES.map((locale) => placeholders[locale]);
    if (sets.every((set) => set !== undefined) && new Set(sets.map((set) => set.join(','))).size > 1) {
      problems.push({ kind: 'placeholders', key, placeholders: placeholders as Record<Locale, string[]> });
    }
  }
  return problems;
}

/** Reads `<dir>/<locale>.json` for every locale. */
export function readCatalogs(dir: string): Record<Locale, Catalog> {
  const entries = LOCALES.map((locale) => {
    const file = path.join(dir, `${locale}.json`);
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(`${file} must contain a JSON object of messages`);
    }
    return [locale, parsed as Catalog] as const;
  });
  return Object.fromEntries(entries) as Record<Locale, Catalog>;
}

/**
 * Keys that no source file under `globs` mentions as a whole identifier (`m.some_key()`,
 * `import { some_key }`). Tests and generated Paraglide output do not count as usage.
 */
export function findUnusedKeys(keys: readonly string[], root: string, globs: readonly string[]): string[] {
  const sources = globSync([...globs], {
    cwd: root,
    exclude: ['**/node_modules/**', '**/src/paraglide/**', '**/*.test.{ts,tsx}'],
  }).map((file) => readFileSync(path.join(root, file), 'utf8'));
  return keys.filter((key) => {
    const pattern = new RegExp(`(?<![\\w$])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
    return !sources.some((source) => pattern.test(source));
  });
}

function describeProblem(problem: CatalogProblem): string {
  switch (problem.kind) {
    case 'missing':
      return `${problem.key}: missing in ${problem.locale}`;
    case 'invalid':
      return `${problem.key}: not a valid message in ${problem.locale} (expected a string or an array of variants)`;
    case 'empty':
      return `${problem.key}: empty text in ${problem.locale}`;
    case 'placeholders':
      return `${problem.key}: placeholders differ (${LOCALES.map(
        (locale) => `${locale}: {${problem.placeholders[locale].join(', ')}}`,
      ).join('; ')})`;
  }
}

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

const USAGE = 'Usage: check-i18n [--unused]';

/** Checks the message catalogs under `root` and returns the process exit code. */
export function run(args: readonly string[], root: string, output: Output): number {
  if (args.some((arg) => arg !== '--unused')) {
    output.error(USAGE);
    return 2;
  }
  const catalogs = readCatalogs(path.join(root, MESSAGES_DIR));
  const lines = checkCatalogs(catalogs).map(describeProblem);
  if (args.includes('--unused')) {
    const unused = findUnusedKeys(messageKeys(catalogs), root, SOURCE_GLOBS);
    lines.push(...unused.map((key) => `${key}: not used in ${SOURCE_GLOBS.join(', ')}`));
  }
  if (lines.length > 0) {
    output.error(`Message catalog problems in ${MESSAGES_DIR}:\n${lines.map((line) => `  - ${line}`).join('\n')}`);
    return 1;
  }
  output.log(`Message catalogs are complete in ${LOCALES.join(', ')}.`);
  return 0;
}
