/**
 * Variable-contract derivation: documented / undocumented / stale.
 *
 * The body is the single source of truth for which variables exist
 * (`parseVariables(body)`); frontmatter annotations can never create a
 * variable. This module turns body + annotations into the three derived
 * signals the UI surfaces:
 *
 *   documented   — a body variable that has an annotation.
 *   undocumented — a body variable with no annotation.
 *   stale        — an annotation whose variable no longer appears in body.
 *
 * It is deliberately pure and has no UI or persistence side effects.
 */
import { parseVariables } from './variables';
import type { VariableDoc } from '$lib/prompts/types';

export interface DocumentedVariable {
  name: string;
  description?: string;
  example?: string;
}

export interface UndocumentedVariable {
  name: string;
}

export interface StaleVariableDoc {
  name: string;
  description?: string;
  example?: string;
}

export interface VariableContract {
  documented: DocumentedVariable[];
  undocumented: UndocumentedVariable[];
  stale: StaleVariableDoc[];
}

/**
 * The documented / undocumented / stale classification from a pre-parsed list
 * of variable names. This is the single implementation behind both
 * `deriveVariableContract` (which parses the body) and Prompt Health (which
 * works from a disposable derived index), so the two can never drift apart.
 */
export function classifyVariableContract(
  variableNames: string[],
  annotations: Record<string, VariableDoc> | undefined
): VariableContract {
  const docs = annotations ?? {};

  const documented: DocumentedVariable[] = [];
  const undocumented: UndocumentedVariable[] = [];
  for (const name of variableNames) {
    // Own-property check only: the grammar allows any [A-Za-z0-9_-]+ name,
    // so {constructor}, {toString} and {__proto__} are legal variables and
    // must not match Object.prototype members when no annotation exists.
    const doc = Object.hasOwn(docs, name) ? docs[name] : undefined;
    if (doc) {
      documented.push({ name, description: doc.description, example: doc.example });
    } else {
      undocumented.push({ name });
    }
  }

  const stale: StaleVariableDoc[] = [];
  for (const [name, doc] of Object.entries(docs)) {
    if (!variableNames.includes(name)) {
      stale.push({ name, description: doc.description, example: doc.example });
    }
  }

  return { documented, undocumented, stale };
}

export function deriveVariableContract(
  body: string,
  annotations: Record<string, VariableDoc> | undefined
): VariableContract {
  return classifyVariableContract(
    parseVariables(body).map((variable) => variable.name),
    annotations
  );
}

/**
 * Return `variables` with `name`'s annotation set to `doc` (or removed when
 * `doc` is undefined or empty). Rebuilt immutably via `Object.fromEntries` so
 * a variable literally named `__proto__` becomes an own data property instead
 * of mutating the map's prototype. Returns undefined when nothing is left.
 */
export function setVariableDoc(
  variables: Record<string, VariableDoc> | undefined,
  name: string,
  doc: VariableDoc | undefined
): Record<string, VariableDoc> | undefined {
  const entries = Object.entries(variables ?? {}).filter(([key]) => key !== name);
  if (doc && (doc.description || doc.example || Object.keys(doc.extra ?? {}).length)) {
    entries.push([name, doc]);
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}
