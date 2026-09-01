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

export function deriveVariableContract(
  body: string,
  annotations: Record<string, VariableDoc> | undefined
): VariableContract {
  const vars = parseVariables(body);
  const docs = annotations ?? {};

  const documented: DocumentedVariable[] = [];
  const undocumented: UndocumentedVariable[] = [];
  for (const variable of vars) {
    const doc = docs[variable.name];
    if (doc) {
      documented.push({ name: variable.name, description: doc.description, example: doc.example });
    } else {
      undocumented.push({ name: variable.name });
    }
  }

  const stale: StaleVariableDoc[] = [];
  for (const [name, doc] of Object.entries(docs)) {
    if (!vars.some((variable) => variable.name === name)) {
      stale.push({ name, description: doc.description, example: doc.example });
    }
  }

  return { documented, undocumented, stale };
}
