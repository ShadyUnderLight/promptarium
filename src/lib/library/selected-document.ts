import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
import { summaryFingerprint, type EntryFingerprint } from './search-index';

export function summaryFromDocument(document: PromptDocument): PromptSummary {
  return {
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
}

export function openedFingerprintForDocument(document: PromptDocument): EntryFingerprint {
  return summaryFingerprint(summaryFromDocument(document));
}
