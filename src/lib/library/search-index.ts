import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
import { parseVariables } from '$lib/variables/variables';

export interface EntryFingerprint {
  modifiedAt: number;
  sizeBytes: number;
}

export interface SearchEntry {
  summary: PromptSummary;
  fingerprint: EntryFingerprint;
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

export interface IndexRefreshPlan {
  reused: Map<string, SearchEntry>;
  toRead: PromptSummary[];
  removed: string[];
}

export function summaryFingerprint(summary: PromptSummary): EntryFingerprint {
  return {
    modifiedAt: summary.modifiedAt,
    sizeBytes: summary.sizeBytes,
  };
}

export function fingerprintsMatch(a: EntryFingerprint, b: EntryFingerprint): boolean {
  return a.modifiedAt === b.modifiedAt && a.sizeBytes === b.sizeBytes;
}

/** Pure planner: decide which entries to reuse, reread, or drop after a scan. */
export function planIndexRefresh(
  oldIndex: Map<string, SearchEntry> | undefined,
  summaries: PromptSummary[]
): IndexRefreshPlan {
  const reused = new Map<string, SearchEntry>();
  const toRead: PromptSummary[] = [];
  const seen = new Set<string>();

  for (const summary of summaries) {
    seen.add(summary.name);
    const fingerprint = summaryFingerprint(summary);
    const existing = oldIndex?.get(summary.name);
    if (existing && fingerprintsMatch(existing.fingerprint, fingerprint)) {
      reused.set(summary.name, {
        ...existing,
        summary,
        fingerprint,
      });
    } else {
      toRead.push(summary);
    }
  }

  const removed: string[] = [];
  if (oldIndex) {
    for (const name of oldIndex.keys()) {
      if (!seen.has(name)) removed.push(name);
    }
  }

  return { reused, toRead, removed };
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
    sizeBytes: document.sizeBytes,
    hasFrontmatter: document.hasFrontmatter,
    frontmatterError: document.frontmatterError,
  };
  const variables = parseVariables(document.body);
  return {
    summary,
    fingerprint: summaryFingerprint(summary),
    bodyLower: document.body.toLowerCase(),
    variableCount: variables.length,
    variableNames: variables.map((variable) => variable.name),
    bodyEmpty: document.body.trim().length === 0,
  };
}

export function summaryEntryFromScan(summary: PromptSummary): SearchEntry {
  return {
    summary,
    fingerprint: summaryFingerprint(summary),
    bodyLower: '',
  };
}

export interface RefreshBuildStats {
  planned: number;
  bodyReads: number;
  selectedReuses: number;
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

/** Build a candidate index from a refresh plan; stats count actual body reads separately. */
export async function buildSearchIndexFromPlan(
  plan: IndexRefreshPlan,
  options: {
    projectPath: string;
    readBody: (summary: PromptSummary) => Promise<SearchEntry>;
    selectedEntry?: (summary: PromptSummary) => SearchEntry | null;
  }
): Promise<{ index: Map<string, SearchEntry>; stats: RefreshBuildStats }> {
  const index = new Map(plan.reused);
  const stats: RefreshBuildStats = {
    planned: plan.toRead.length,
    bodyReads: 0,
    selectedReuses: 0,
  };
  let next = 0;
  const toRead = plan.toRead;

  const worker = async (): Promise<void> => {
    while (next < toRead.length) {
      const prompt = toRead[next++];
      let entry = summaryEntryFromScan(prompt);
      try {
        const selected = options.selectedEntry?.(prompt);
        if (selected) {
          stats.selectedReuses++;
          entry = selected;
        } else {
          stats.bodyReads++;
          entry = await options.readBody(prompt);
        }
      } catch {
        // The summary is still useful for name/path/metadata search when a file
        // disappears between scan and index construction.
      }
      index.set(prompt.name, entry);
    }
  };

  if (toRead.length > 0) {
    const workers = Math.min(8, Math.max(1, toRead.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  return { index, stats };
}
