/** TypeScript mirror of the Rust prompt command seam. Pure types and helpers. */

export interface Project {
  /** The folder path is the project identity. */
  name: string;
  path: string;
  color?: string;
}

export interface ProjectList {
  projects: Project[];
  active: string | null;
}

export type PromptStatus = 'draft' | 'active' | 'archived';

/** A variable's optional human-readable annotation. Existence is decided
 *  exclusively by the body parser; this only describes a variable. Unknown
 *  nested YAML fields are preserved in `extra` and never dropped on save. */
export interface VariableDoc {
  description?: string;
  example?: string;
  extra?: Record<string, unknown>;
}

export interface PromptMetadata {
  description: string;
  tags: string[];
  status: PromptStatus;
  favorite: boolean;
  models: string[];
  created?: string;
  /** Variable annotations keyed by variable name; never the source of a
   *  variable's existence (that is `parseVariables(body)`). */
  variables?: Record<string, VariableDoc>;
  /** Explicit links to other prompts in this project, as project-relative
   *  prompt paths without `.md`. Backlinks are derived, never stored. */
  related: string[];
  /** Unknown YAML keys are carried through a supported-field save. */
  extra: Record<string, unknown>;
}

export function defaultPromptMetadata(): PromptMetadata {
  return {
    description: '',
    tags: [],
    status: 'active',
    favorite: false,
    models: [],
    related: [],
    extra: {},
  };
}

/** The frontmatter key that names an explicit variant parent. It is an
 *  additive, optional field (contract invariant #8) that Rust preserves as an
 *  unknown top-level key in `extra` (#9: unknown fields round-trip), so Issue
 *  #14 needs no backend change: the value is read and written through `extra`. */
const VARIANT_OF_KEY = 'variantOf';

/** Read the explicit variant parent path from metadata, if any. Only a
 *  non-empty string is a meaningful variant parent; an invalid or missing
 *  value is surfaced by the variant resolver / Health, never normalized. */
export function getVariantOf(metadata: PromptMetadata): string | undefined {
  const value = metadata.extra[VARIANT_OF_KEY];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Return a copy of `metadata` with `variantOf` set to `path` (removed when
 *  `path` is empty or undefined). The value stays in `extra`, so it round-trips
 *  through the existing serializer exactly like any other unknown field. */
export function withVariantOf(metadata: PromptMetadata, path: string | undefined): PromptMetadata {
  const extra = { ...metadata.extra };
  const trimmed = path?.trim();
  if (trimmed) extra[VARIANT_OF_KEY] = trimmed;
  else delete extra[VARIANT_OF_KEY];
  return { ...metadata, extra };
}

/** Lightweight library row; bodies are loaded only for the selected prompt. */
export interface PromptSummary {
  projectPath: string;
  relativePath: string;
  name: string;
  folder: string;
  extension: '.md';
  metadata: PromptMetadata;
  modifiedAt: number;
  sizeBytes: number;
  hasFrontmatter: boolean;
  frontmatterError?: string;
}

export interface PromptDocument extends PromptSummary {
  body: string;
  raw: string;
  /** Exact opening/closing header when it can be preserved on a body save. */
  frontmatterPrefix?: string;
}

export interface FolderNode {
  path: string;
  name: string;
  promptCount: number;
  children: FolderNode[];
}

export type PromptSort =
  | 'name-asc'
  | 'name-desc'
  | 'modified-desc'
  | 'modified-asc'
  | 'favorite-first';
export type PromptViewMode = 'list' | 'grid';
