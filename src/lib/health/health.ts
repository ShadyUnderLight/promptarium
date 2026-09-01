/**
 * Prompt Health derivation (Issue #13).
 *
 * Health reports only DETERMINISTIC structural problems — never an AI quality
 * score, never a judgment of prompt wording, effect or model performance. Every
 * signal here is rebuilt from sources the rest of the app already produces:
 *
 *   - frontmatter diagnostics (the Rust parser's `frontmatterError`)
 *   - the body variable parser (variable names, via the same grammar the editor
 *     uses)
 *   - variable annotations (`metadata.variables`, classified by
 *     `classifyVariableContract`)
 *   - the relation classifier (`isCanonicalRelationPath`, mirroring
 *     `relations.ts` resolveRelations) checked against the project's prompt
 *     names
 *
 * Health is pure derived state: it is never written back to Markdown and is
 * cached only as a disposable in-memory index by the caller. The module has no
 * UI and no I/O side effects, so it can be unit-tested as plain vectors.
 */
import type { VariableDoc } from '$lib/prompts/types';
import { isCanonicalRelationPath } from '$lib/relations/relations';
import { classifyVariableContract } from '$lib/variables/contract';

export type PromptHealthCode =
  | 'INVALID_FRONTMATTER'
  | 'EMPTY_BODY'
  | 'UNDOCUMENTED_VARIABLE'
  | 'STALE_VARIABLE_DOCUMENTATION'
  | 'BROKEN_RELATED_PROMPT'
  | 'INVALID_RELATED_PROMPT'
  | 'SELF_RELATED_PROMPT';

export interface PromptHealthIssue {
  code: PromptHealthCode;
  severity: 'warning' | 'error';
  message: string;
  detail?: string;
}

/** Everything `derivePromptHealth` needs, pre-parsed so health can be computed
 *  from a disposable derived index without ever re-reading a prompt body. */
export interface PromptHealthInput {
  projectPath: string;
  name: string;
  frontmatterError?: string;
  /** True when the body is empty or whitespace-only after trim. */
  bodyEmpty: boolean;
  /** Variable names in first-appearance order, produced by the body parser. */
  variableNames: string[];
  variables?: Record<string, VariableDoc>;
  related: string[];
  /** Names of every prompt in the same project (for relation target existence). */
  projectPromptNames: ReadonlySet<string>;
}

/** Fixed emission order so multi-issue output is deterministic across runs. */
const CODE_ORDER: PromptHealthCode[] = [
  'INVALID_FRONTMATTER',
  'EMPTY_BODY',
  'UNDOCUMENTED_VARIABLE',
  'STALE_VARIABLE_DOCUMENTATION',
  'BROKEN_RELATED_PROMPT',
  'INVALID_RELATED_PROMPT',
  'SELF_RELATED_PROMPT',
];

/**
 * Derive a prompt's deterministic structural issues. The result is sorted by a
 * fixed code order and then by message, so equal inputs always produce the same
 * ordered output.
 */
export function derivePromptHealth(input: PromptHealthInput): PromptHealthIssue[] {
  const issues: PromptHealthIssue[] = [];

  if (input.frontmatterError) {
    issues.push({
      code: 'INVALID_FRONTMATTER',
      severity: 'warning',
      message: 'Frontmatter is malformed',
      detail: input.frontmatterError,
    });
  }

  if (input.bodyEmpty) {
    issues.push({
      code: 'EMPTY_BODY',
      severity: 'warning',
      message: 'Prompt body is empty',
      detail: 'The prompt has no body text after its frontmatter.',
    });
  }

  const contract = classifyVariableContract(input.variableNames, input.variables);
  for (const variable of contract.undocumented) {
    issues.push({
      code: 'UNDOCUMENTED_VARIABLE',
      severity: 'warning',
      message: `Variable {${variable.name}} has no documentation`,
      detail: `{${variable.name}} appears in the body but has no description or example annotation.`,
    });
  }
  for (const variable of contract.stale) {
    issues.push({
      code: 'STALE_VARIABLE_DOCUMENTATION',
      severity: 'warning',
      message: `Variable annotation {${variable.name}} is stale`,
      detail: `{${variable.name}} is documented but no longer appears in the body.`,
    });
  }

  // Mirror relations.ts resolveRelations classification exactly: self →
  // invalid → missing. Keeping both in step matters because the Related UI and
  // Health must never disagree about the same related entry.
  for (const path of input.related) {
    if (path === input.name) {
      issues.push({
        code: 'SELF_RELATED_PROMPT',
        severity: 'warning',
        message: 'Prompt is related to itself',
        detail: `The related entry ${path} references this prompt.`,
      });
      continue;
    }
    if (!isCanonicalRelationPath(path)) {
      issues.push({
        code: 'INVALID_RELATED_PROMPT',
        severity: 'error',
        message: `Related prompt ${path} is invalid`,
        detail: `${path} is not a project-relative prompt path without a .md suffix.`,
      });
      continue;
    }
    if (!input.projectPromptNames.has(path)) {
      issues.push({
        code: 'BROKEN_RELATED_PROMPT',
        severity: 'warning',
        message: `Related prompt ${path} does not exist`,
        detail: `${path} is listed in related but no such prompt exists in this project.`,
      });
    }
  }

  return sortIssues(issues);
}

function sortIssues(issues: PromptHealthIssue[]): PromptHealthIssue[] {
  const order = new Map(CODE_ORDER.map((code, index) => [code, index]));
  return [...issues].sort((a, b) => {
    const byCode = (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0);
    if (byCode !== 0) return byCode;
    return (a.detail ?? a.message).localeCompare(b.detail ?? b.message);
  });
}
