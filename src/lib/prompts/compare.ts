/**
 * Prompt-to-prompt compare (Issue #14).
 *
 * Two pure, deterministic functions:
 *   - diffTexts(a, b)    : a unified-style patch string for two Markdown
 *                          bodies, rendered by the existing DiffViewer with the
 *                          same visual language as Git History, but sourced
 *                          from two current files instead of a commit patch.
 *   - diffMetadata(a, b) : a deterministic list of metadata field differences
 *                          (description / status / favorite / models / tags /
 *                          related / variables / variantOf / extra).
 *
 * Both are pure (no I/O), so they can be unit-tested as plain vectors and
 * reused by the temporary Compare sheet.
 */
import type { VariableDoc } from './types';
import { getVariantOfRaw } from './types';
import type { RawYaml } from './types';
import type { PromptMetadata } from './types';

/** Number of unchanged lines of context around a change in the rendered patch. */
const CONTEXT_LINES = 3;

interface LineOp {
  kind: 'same' | 'del' | 'add';
  text: string;
  /** 1-based line number in the left (old) body; present for 'same'/'del'. */
  aLine?: number;
  /** 1-based line number in the right (new) body; present for 'same'/'add'. */
  bLine?: number;
}

function splitBodyLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Longest-common-subsequence diff over lines, deterministic: on a tie a
 *  deletion is preferred over an insertion, matching common diff ordering. */
function lcsOps(a: string[], b: string[]): LineOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'del', text: a[i], aLine: i + 1 });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j], bLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', text: a[i], aLine: i + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ kind: 'add', text: b[j], bLine: j + 1 });
    j++;
  }
  return ops;
}

interface Hunk {
  start: number;
  end: number;
}

/** Group change ops into hunks separated by more than 2*context unchanged
 *  lines, then expand each hunk by context on both sides and merge overlaps. */
function buildHunks(ops: LineOp[]): Hunk[] {
  const changeIdx: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind !== 'same') changeIdx.push(i);
  }
  if (!changeIdx.length) return [];

  const hunks: Hunk[] = [];
  let curStart = -1;
  let curEnd = -1;
  for (const idx of changeIdx) {
    if (curStart === -1) {
      curStart = idx;
      curEnd = idx;
    } else if (idx - curEnd - 1 > 2 * CONTEXT_LINES) {
      hunks.push({ start: curStart, end: curEnd });
      curStart = idx;
      curEnd = idx;
    } else {
      curEnd = idx;
    }
  }
  hunks.push({ start: curStart, end: curEnd });

  const expanded: Hunk[] = [];
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.start - CONTEXT_LINES);
    const end = Math.min(ops.length - 1, hunk.end + CONTEXT_LINES);
    const last = expanded[expanded.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else expanded.push({ start, end });
  }
  return expanded;
}

function renderHunks(ops: LineOp[], hunks: Hunk[]): string {
  let out = '';
  for (const hunk of hunks) {
    let aStart = 0;
    let bStart = 0;
    let aCount = 0;
    let bCount = 0;
    for (let i = hunk.start; i <= hunk.end; i++) {
      const op = ops[i];
      if (op.kind === 'del' || op.kind === 'same') {
        if (aStart === 0) aStart = op.aLine!;
        aCount++;
      }
      if (op.kind === 'add' || op.kind === 'same') {
        if (bStart === 0) bStart = op.bLine!;
        bCount++;
      }
    }
    out += `@@ -${aStart || 1},${aCount} +${bStart || 1},${bCount} @@\n`;
    for (let i = hunk.start; i <= hunk.end; i++) {
      const op = ops[i];
      if (op.kind === 'same') out += ' ' + op.text + '\n';
      else if (op.kind === 'del') out += '-' + op.text + '\n';
      else out += '+' + op.text + '\n';
    }
  }
  return out;
}

/** Unified-style patch string between two bodies; empty string when identical. */
export function diffTexts(a: string, b: string): string {
  const aLines = splitBodyLines(a);
  const bLines = splitBodyLines(b);
  const ops = lcsOps(aLines, bLines);
  const hunks = buildHunks(ops);
  if (!hunks.length) return '';
  return renderHunks(ops, hunks);
}

export interface MetadataFieldDiff {
  field: string;
  /** Left-side (selected prompt) rendered value. */
  left: string;
  /** Right-side (compared prompt) rendered value. */
  right: string;
}

function renderList(value: string[]): string {
  return value.length ? value.join(', ') : '(none)';
}

function renderVariables(value: Record<string, VariableDoc> | undefined): string {
  if (!value || !Object.keys(value).length) return '(none)';
  return Object.keys(value)
    .sort()
    .map((name) => {
      const doc = value[name];
      const parts = [name];
      if (doc?.description) parts.push('desc: ' + doc.description);
      if (doc?.example) parts.push('example: ' + doc.example);
      return parts.join(' ');
    })
    .join(' | ');
}

function renderExtra(value: Record<string, unknown>): string {
  const keys = Object.keys(value)
    .filter((key) => key !== 'variantOf' && key !== 'notes' && key !== 'examples')
    .sort();
  if (!keys.length) return '(none)';
  return keys.map((key) => key + ': ' + JSON.stringify(value[key])).join(' | ');
}

/** Deterministic, order-insensitive normalization of a `RawYaml` node for the
 *  Compare sheet: mapping keys are sorted so key order never produces a spurious
 *  diff, while sequence order is preserved because example array position is
 *  meaningful. Covers every `RawYaml` kind exhaustively. */
function normalizeRawYaml(node: RawYaml): string {
  switch (node.kind) {
    case 'null':
      return 'null';
    case 'bool':
      return String(node.value);
    case 'number':
      return node.value.kind + ':' + String(node.value.value);
    case 'string':
      return JSON.stringify(node.value);
    case 'sequence':
      return '[' + node.items.map(normalizeRawYaml).join(',') + ']';
    case 'mapping':
      return (
        '{' +
        node.pairs
          .map(([key, value]) => normalizeRawYaml(key) + ':' + normalizeRawYaml(value))
          .sort()
          .join(',') +
        '}'
      );
    case 'tagged':
      return '!' + node.tag + '(' + normalizeRawYaml(node.value) + ')';
  }
}

/** Deterministic rendering of examples for the Compare sheet. The authoritative
 *  representation is the raw semantic AST when present — it carries
 *  invalid/hand-written examples that the typed projection cannot, so two
 *  malformed examples that project identically still diff, while mapping key
 *  order does not produce a spurious diff. Falls back to the typed projection
 *  only when no raw exists (fresh create/duplicate). Compared on its own row;
 *  never reported through the generic `extra` diff as well. */
function renderExamples(metadata: PromptMetadata): string {
  if (metadata.examplesRaw !== undefined) {
    return normalizeRawYaml(metadata.examplesRaw);
  }
  const value = metadata.examples;
  if (!value || !value.length) return '(none)';
  return value.map((example) => JSON.stringify(example)).join('\n');
}

function renderVariantOf(metadata: PromptMetadata): string {
  const raw = getVariantOfRaw(metadata);
  if (raw === undefined) return '(none)';
  if (typeof raw === 'string') return raw;
  // Wrong YAML type (number / array / …): show the type so the diff is honest
  // about the mismatch instead of collapsing it to "(none)".
  return `${typeof raw}: ${JSON.stringify(raw)}`;
}

/** Normalize "no notes" and "empty notes" to a single value: the storage
 *  contract treats both as "no Usage Notes" (empty notes are removed from the
 *  frontmatter on the next metadata save). Only the exact empty string is
 *  normalized — whitespace-only values are preserved as real content. */
function renderNotes(value: string | undefined): string {
  return value === undefined || value === '' ? '(none)' : value;
}

/** Deterministic list of metadata field differences between two prompts. The
 *  `variantOf`, `notes` and `examples` fields are compared on their own rows
 *  and excluded from `extra`, so a change is never reported twice. Order is
 *  fixed for stable output. */
export function diffMetadata(a: PromptMetadata, b: PromptMetadata): MetadataFieldDiff[] {
  const pairs: Array<[string, string, string]> = [
    ['description', a.description, b.description],
    ['status', a.status, b.status],
    ['favorite', a.favorite ? 'true' : 'false', b.favorite ? 'true' : 'false'],
    ['models', renderList(a.models), renderList(b.models)],
    ['tags', renderList(a.tags), renderList(b.tags)],
    ['related', renderList(a.related), renderList(b.related)],
    ['variables', renderVariables(a.variables), renderVariables(b.variables)],
    ['variantOf', renderVariantOf(a), renderVariantOf(b)],
    ['notes', renderNotes(a.notes), renderNotes(b.notes)],
    ['examples', renderExamples(a), renderExamples(b)],
    ['extra', renderExtra(a.extra), renderExtra(b.extra)],
  ];
  const diffs: MetadataFieldDiff[] = [];
  for (const [field, left, right] of pairs) {
    if (left !== right) diffs.push({ field, left, right });
  }
  return diffs;
}
