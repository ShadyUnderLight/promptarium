import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
import { parseVariables } from '$lib/variables/variables';

export const BODY_EXCERPT_MAX_LENGTH = 120;

/** Truncate by Unicode code point so astral symbols (emoji) are never split. */
export function truncateExcerptText(text: string, maxLength: number): string {
  const units = Array.from(text);
  if (units.length <= maxLength) return text;
  return units.slice(0, maxLength - 1).join('').trimEnd() + '…';
}

const BACKTICK_FENCE = '```';

export type ExcerptSegment =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string };

function fenceMarkerAtLine(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith(BACKTICK_FENCE)) return BACKTICK_FENCE;
  if (trimmed.startsWith('~~~')) return '~~~';
  return null;
}

function splitInlineCodeSegments(segments: ExcerptSegment[]): ExcerptSegment[] {
  const result: ExcerptSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === 'code') {
      result.push(segment);
      continue;
    }
    const text = segment.value;
    const pattern = /`([^`\n]*)`/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
      }
      result.push({ kind: 'code', value: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      result.push({ kind: 'text', value: text.slice(lastIndex) });
    }
  }
  return result;
}

/** Split body into prose and code segments. Fenced blocks and inline backticks
 *  are code segments whose payload is never Markdown-stripped. */
export function parseExcerptSegments(body: string): ExcerptSegment[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const segments: ExcerptSegment[] = [];
  let index = 0;
  let proseBuffer: string[] = [];

  function flushProse(): void {
    if (!proseBuffer.length) return;
    segments.push({ kind: 'text', value: proseBuffer.join('\n') });
    proseBuffer = [];
  }

  while (index < lines.length) {
    const marker = fenceMarkerAtLine(lines[index]);
    if (marker) {
      flushProse();
      index++;
      const blockLines: string[] = [];
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        blockLines.push(lines[index]);
        index++;
      }
      if (blockLines.length) {
        segments.push({ kind: 'code', value: blockLines.join('\n') });
      }
      if (index < lines.length) index++;
      continue;
    }
    proseBuffer.push(lines[index]);
    index++;
  }
  flushProse();
  return splitInlineCodeSegments(segments);
}

function stripMarkdownFromProse(text: string): string {
  let stripped = text;
  stripped = stripped.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  stripped = stripped.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  stripped = stripped.replace(/^#{1,6}\s+/gm, '');
  stripped = stripped.replace(/^>\s?/gm, '');
  stripped = stripped.replace(/^\s*[-*+]\s+/gm, '');
  stripped = stripped.replace(/^\s*\d+\.\s+/gm, '');
  stripped = stripped.replace(/(\*\*|__)(.*?)\1/g, '$2');
  stripped = stripped.replace(/(\*|_)(.*?)\1/g, '$2');
  stripped = stripped.replace(/^[-*_]{3,}\s*$/gm, ' ');
  return stripped;
}

function flattenExcerptSegment(segment: ExcerptSegment): string {
  const flattened = segment.value.replace(/\s+/g, ' ').trim();
  return segment.kind === 'code' ? flattened : stripMarkdownFromProse(flattened);
}

/** Strip common Markdown syntax for a one-line list excerpt. Preserves case. */
export function stripMarkdownForExcerpt(body: string): string {
  const parts = parseExcerptSegments(body)
    .map(flattenExcerptSegment)
    .filter((part) => part.length > 0);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Plain-text excerpt for prompt list rows; undefined when the body is empty. */
export function bodyExcerptFromBody(
  body: string,
  maxLength = BODY_EXCERPT_MAX_LENGTH
): string | undefined {
  const stripped = stripMarkdownForExcerpt(body);
  if (!stripped) return undefined;
  return truncateExcerptText(stripped, maxLength);
}

export interface SearchEntry {
  summary: PromptSummary;
  bodyLower: string;
  /** Plain-text list excerpt from this round's body read; absent on scan fallback. */
  bodyExcerpt?: string;
  variableCount?: number;
  /** Variable names in first-appearance order, produced by the one body parser.
   *  Present when the body was read; absent on the scan fallback. Prompt Health
   *  derives its variable issues from this, never from a second body pass. */
  variableNames?: string[];
  /** True when the body is empty or whitespace-only after trim. Present only
   *  when the body was read; the scan fallback reports false. */
  bodyEmpty?: boolean;
}

export function searchEntryFromDocument(document: PromptDocument): SearchEntry {
  const summary: PromptSummary = {
    projectPath: document.projectPath,
    relativePath: document.relativePath,
    name: document.name,
    folder: document.folder,
    extension: document.extension,
    metadata: document.metadata,
    modifiedAt: document.modifiedAt,
    hasFrontmatter: document.hasFrontmatter,
    frontmatterError: document.frontmatterError,
  };
  const variables = parseVariables(document.body);
  const bodyExcerpt = bodyExcerptFromBody(document.body);
  return {
    summary,
    bodyLower: document.body.toLowerCase(),
    ...(bodyExcerpt ? { bodyExcerpt } : {}),
    variableCount: variables.length,
    variableNames: variables.map((variable) => variable.name),
    bodyEmpty: document.body.trim().length === 0,
  };
}

/** Scan fallback entry when a body read fails; still searchable by name/path/metadata. */
function summaryEntryFromScan(summary: PromptSummary): SearchEntry {
  return {
    summary,
    bodyLower: '',
  };
}

export interface RefreshBuildStats {
  planned: number;
  bodyReads: number;
  failedReads: number;
}

export function isStaleSearchIndexSwap(revisionAtStart: number, currentRevision: number): boolean {
  return revisionAtStart !== currentRevision;
}

export interface BuildUntilRevisionStableResult<T> {
  value: T;
  retried: boolean;
}

/** Rebuild until revision is stable; commit runs in the same sync continuation as the final revision check. */
export async function buildUntilRevisionStable<T>(options: {
  getRevision: () => number;
  shouldAbort?: () => boolean;
  build: () => Promise<T>;
  commit: (candidate: T) => void;
}): Promise<BuildUntilRevisionStableResult<T> | null> {
  let retried = false;
  while (true) {
    if (options.shouldAbort?.()) return null;
    const revisionAtStart = options.getRevision();
    const candidate = await options.build();
    if (options.shouldAbort?.()) return null;
    if (isStaleSearchIndexSwap(revisionAtStart, options.getRevision())) {
      retried = true;
      continue;
    }
    options.commit(candidate);
    return { value: candidate, retried };
  }
}

/** Build a fresh index from this round's summaries by bounded-reading each body.
 *  Every refresh rebuilds from the bodies read this round — no mtime/size reuse
 *  — so search, variable counts and Health always reflect the current content.
 *  A failed body read keeps a summary-only entry so one bad file never clears
 *  the other prompts' results; the complete Map is swapped in only at the end. */
export async function buildSearchIndex(
  summaries: PromptSummary[],
  options: {
    readBody: (summary: PromptSummary) => Promise<SearchEntry>;
  }
): Promise<{ index: Map<string, SearchEntry>; stats: RefreshBuildStats }> {
  const index = new Map<string, SearchEntry>();
  const stats: RefreshBuildStats = {
    planned: summaries.length,
    bodyReads: 0,
    failedReads: 0,
  };
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < summaries.length) {
      const prompt = summaries[next++];
      let entry = summaryEntryFromScan(prompt);
      try {
        stats.bodyReads++;
        entry = await options.readBody(prompt);
      } catch {
        stats.failedReads++;
        // The summary is still useful for name/path/metadata search when a file
        // disappears between scan and index construction.
      }
      index.set(prompt.name, entry);
    }
  };

  if (summaries.length > 0) {
    const workers = Math.min(8, Math.max(1, summaries.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  return { index, stats };
}
