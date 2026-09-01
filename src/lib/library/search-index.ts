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
  return {
    summary,
    fingerprint: summaryFingerprint(summary),
    bodyLower: document.body.toLowerCase(),
    variableCount: parseVariables(document.body).length,
  };
}

export function summaryEntryFromScan(summary: PromptSummary): SearchEntry {
  return {
    summary,
    fingerprint: summaryFingerprint(summary),
    bodyLower: '',
  };
}
