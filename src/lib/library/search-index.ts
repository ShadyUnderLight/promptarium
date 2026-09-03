import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
import { parseVariables } from '$lib/variables/variables';

export interface SearchEntry {
  summary: PromptSummary;
  bodyLower: string;
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
  return {
    summary,
    bodyLower: document.body.toLowerCase(),
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
