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

/** One prompt example (Issue #24), mirroring the Rust `PromptExample` DTO.
 *  camelCase in IPC, snake_case in YAML. A typed projection is read-only for
 *  now (no Examples editor in this issue); invalid/hand-written examples are
 *  preserved semantically through `examplesRaw` on an unrelated metadata save,
 *  never through truncation of this typed Vec. */
export interface PromptExample {
  name?: string;
  input?: string;
  inputFile?: string;
  output?: string;
  outputFile?: string;
  notes?: string;
  assets?: string[];
  /** Unknown nested YAML keys inside one example, carried through a save. */
  extra?: Record<string, unknown>;
}

/** Resolution state of one asset reference (Issue #25). `resolved` = existing
 *  regular non-`.md` file inside the Project; `missing` = syntactically valid
 *  but absent (a broken reference, not invalid syntax); `invalid` = an unsafe /
 *  unsupported path (absolute, escape, symlink, `.md`, non-regular target). */
export type AssetResolutionState = 'resolved' | 'missing' | 'invalid';

/** Display-only kind hint derived from the reference extension. Not a security
 *  boundary: any safe non-`.md` regular file can be referenced. */
export type AssetKind = 'image' | 'pdf' | 'text' | 'json' | 'binary';

/** One classified asset reference (Issue #25), mirroring the Rust DTO. Rust is
 *  the only authority on path safety — the frontend never resolves paths. */
export interface ResolvedPromptAsset {
  reference: string;
  state: AssetResolutionState;
  kind?: AssetKind;
  sizeBytes?: number;
  modifiedAt?: number;
  error?: string;
}

/** A YAML scalar number, mirroring the Rust `RawNumber` DTO (Issue #24) so an
 *  IPC JSON round trip is lossless: 64-bit integers are decimal strings (a JS
 *  number silently coerces values past 2^53−1) and floats are IEEE-754 bit
 *  strings (so NaN / ±Inf / −0.0 never touch JSON float semantics). */
export type RawNumber =
  | { kind: 'i64'; value: string }
  | { kind: 'u64'; value: string }
  | { kind: 'f64'; bits: string };

/** IPC-safe semantic AST for arbitrary YAML, mirroring the Rust `RawYaml` DTO
 *  (Issue #24). Every `serde_yaml::Value` variant is represented explicitly so
 *  no node — non-string mapping keys, tagged values — is dropped or flattened
 *  into a JSON-only shape. Mapping keys are kept as a pair list so non-string
 *  keys survive. */
export type RawYaml =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'number'; value: RawNumber }
  | { kind: 'string'; value: string }
  | { kind: 'sequence'; items: RawYaml[] }
  | { kind: 'mapping'; pairs: [RawYaml, RawYaml][] }
  | { kind: 'tagged'; tag: string; value: RawYaml };

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
  /** Usage notes that are not part of the prompt body (Issue #15). Copy Prompt
   *  never includes them. Multiline values serialize as readable YAML block
   *  scalars; clearing the field removes `notes` from the frontmatter. */
  notes?: string;
  /** Prompt examples (Issue #24). Typed projection; the authoritative value for
   *  an unrelated metadata save is `examplesRaw`, so invalid/hand-written
   *  examples are never truncated to this typed Vec. */
  examples?: PromptExample[];
  /** IPC-safe semantic AST of the `examples` frontmatter field as read from
   *  disk, carried from Rust. The preservation base for an unrelated metadata
   *  save (conversion from YAML is exhaustive and infallible); pass it back
   *  unchanged unless explicitly editing examples. */
  examplesRaw?: RawYaml;
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

/** Raw variantOf value from frontmatter, whatever its YAML type. `undefined`
 *  only when the field is absent or explicitly null — a hand-written value of
 *  the wrong type (number / array / object) is surfaced here so callers can
 *  report it as invalid instead of silently treating it as "no variantOf". */
export function getVariantOfRaw(metadata: PromptMetadata): unknown {
  const value = metadata.extra[VARIANT_OF_KEY];
  return value === undefined || value === null ? undefined : value;
}

/** Read the explicit variant parent path from metadata, if any. Only a
 *  non-empty string is a meaningful variant parent; a present-but-wrong-type
 *  value is surfaced by hasInvalidVariantOfType (and Health / the variant
 *  resolver), never normalized away. */
export function getVariantOf(metadata: PromptMetadata): string | undefined {
  const value = getVariantOfRaw(metadata);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** True when variantOf is present but is not a non-empty string — e.g. a YAML
 *  number, array or object written by hand. Such a value is not a valid parent
 *  path and must be reported as invalid rather than ignored as absent. */
export function hasInvalidVariantOfType(metadata: PromptMetadata): boolean {
  const value = getVariantOfRaw(metadata);
  return value !== undefined && typeof value !== 'string';
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

/** Lightweight library-row DTO; the body is never carried in summaries. The
 *  search index may separately read prompt bodies during a refresh. */
export interface PromptSummary {
  projectPath: string;
  relativePath: string;
  name: string;
  folder: string;
  extension: '.md';
  metadata: PromptMetadata;
  modifiedAt: number;
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
