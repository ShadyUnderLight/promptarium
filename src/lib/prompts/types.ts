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
