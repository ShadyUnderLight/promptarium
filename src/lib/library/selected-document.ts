import type { PromptDocument, PromptSummary } from '$lib/prompts/types';

export function summaryFromDocument(document: PromptDocument): PromptSummary {
  return {
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
}
