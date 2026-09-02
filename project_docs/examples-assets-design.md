# Examples & Assets — Storage Design Spike (Issue #16)

Status: **Design Spike**. This document decides how Prompt *Examples* (sample
input/output) and *Assets* (images, PDFs, JSON/code fixtures, generic binary
files) live on the user's disk, who owns them, how they are referenced, and how
they behave across the existing prompt lifecycle. It introduces **no production
code**; the implementation work is split into follow-up issues (see §18).

## TL;DR — the decision

**Recommended canonical model: Candidate C — inline `examples` frontmatter
metadata + user-owned relative asset paths.**

- Text examples (input/output/notes) that are reasonably small live **inline in
  YAML frontmatter**, exactly like the existing `notes` field.
- Large text, JSON/code fixtures, images, PDFs and other binary files live as
  **plain user files** anywhere inside the project, referenced by a
  project-relative path in the example's `assets` (or `input_file`/`output_file`).
- **No companion directory, no app-owned sidecar, no UUID, no database.** The
  scanner keeps treating every visible `.md` as a prompt; asset references are
  validated to never point at a `.md`, which makes the scanner collision
  structurally impossible without any scanner change.
- **Hand-written or invalid example data is preserved semantically (no data
  loss)** across any unrelated metadata edit — never dropped, normalized or
  silently repaired (§6).
- Existing core contracts (identity = relative `.md` path; delete only removes
  the selected `.md`; no in-project app-owned sidecar) are **preserved**. The
  only contract change is additive: `examples` joins the reserved optional
  frontmatter fields in `prompt-specific-capabilities.md`.

---

## 1. Use cases and constraints

### 1.1 Use cases

Prompt examples are valuable for long-term management of a prompt library:

```text
Prompt
→ Example Input
→ Example Output
```

For image / multimodal prompts, the natural shape is:

```text
Prompt
→ Reference Image
→ Generated Result
→ Screenshot / PDF / JSON fixture
```

Real usage quickly outgrows a few short strings:

- outputs of hundreds or thousands of lines;
- JSON / code fixtures;
- multiple examples per prompt;
- PNG / JPEG / WebP images, PDFs, reference assets and generated outputs.

### 1.2 Constraints that bound the design

These are the existing invariants from `prompts-design.md` and
`prompt-specific-capabilities.md` that any storage model must preserve:

1. A Project is a real folder; its absolute path is the project identity.
2. A Prompt is a real `.md` file; its project-relative path (without `.md`) is
   the prompt identity. **No UUIDs in prompt files.**
3. No app-owned hidden sidecar is written inside a user Project.
4. No authoritative database; `~/.promptarium` holds only disposable app state.
5. Plain Markdown files keep working with zero migration.
6. Every new frontmatter field is optional and additive; reading never rewrites
   the file; unknown YAML fields are preserved across supported edits.
7. The scanner treats every visible `.md` as a prompt and skips dot entries and
   directory symlinks; path validation is fail-closed (no escape, no symlink
   traversal, atomic writes).
8. Delete Prompt removes only the selected `.md` and never prunes its folder.
9. Rust owns all dangerous filesystem / path validation; TypeScript owns the
   only variable grammar.
10. The app is a local-first viewer/editor over files the user owns. Opening,
    scanning, indexing or forgetting a project must not create or modify files
    inside it.

## 2. Decision criteria

Every candidate below is rated against the issue's decision matrix. Ratings are
based on the current implementation (scanner in `src-tauri/src/prompts/store.rs`,
watcher in `src-tauri/src/prompts/watcher.rs`, metadata struct in
`src-tauri/src/prompts/store.rs`, contract docs under `project_docs/`).

| Dimension | A inline | B companion | C rel. paths | D package |
|---|---|---|---|---|
| Local-first (offline) | ✓ | ✓ | ✓ | ✓ |
| Human-readable | ✓ | ✓ | ✓ | ✓ |
| Git-friendly | ✓ (prompt file) | ✓ | ✓ (asset files) | ✓ |
| Portable (project moves) | ✓ | ✓ (if moved with prompt) | ✓ (assets inside project) | ✓ |
| No authoritative DB | ✓ | ✓ | ✓ | ✓ |
| Plain Markdown compat (zero migration) | ✓ | ✓ | ✓ | ✓ |
| Path safety (no escape) | ✓ | ✓ | ✓ (validated) | ✓ |
| Scanner compatibility (no example→prompt) | ✓ | ✗ | ✓ (non-.md rule) | ✗ |
| Large text | weak (YAML bloat) | ✓ | ✓ | ✓ |
| Binary assets | ✗ | ✓ | ✓ | ✓ |
| Rename semantics | clear | unclear (move dir?) | clear (refs stay valid) | unclear |
| Move semantics | clear | unclear | clear | unclear |
| Delete semantics | clear | contract break | clear (never touches assets) | contract break |
| Duplicate semantics | clear | unclear | clear (inline copied, assets shared) | unclear |
| Variant semantics | clear | unclear | clear | unclear |
| All Projects identity isolation | ✓ | ✓ | ✓ | ✓ |
| Watcher boundary | clear | unclear (dir storms) | clear | unclear |
| Search | n/a | unclear | explicit (v1: no) | unclear |
| Git history | prompt file | split | split | split |
| Compare | additive | unclear | additive | unclear |

Legend: ✓ compatible, ✗ violates a core invariant, weak/clear = judgement.

## 3. Candidate comparison

### Candidate A — all inline frontmatter

```yaml
examples:
  - name: Small PR
    input: |
      Repository: foo/bar
      PR: 9
    output: |
      Review result...
```

- **Strengths**: single-file portability; natural Git history; no sidecar;
  rename/move of the prompt is trivial; no scanner collision possible.
- **Weaknesses**: a large output makes the frontmatter enormous and stresses the
  YAML serializer; binary assets cannot be expressed at all; hand-maintained
  large blocks are hard to read.
- **Verdict**: suitable as **one layer** (small text examples), not as the
  complete model. It is absorbed into Candidate C for the text layer.

### Candidate B — prompt frontmatter + user-visible companion directory

```text
review-pr.md
review-pr.assets/
  example-01-input.txt
  example-01-output.md
  screenshot.png
```

- **Strengths**: supports large text and binary; Git-friendly; assets are plain
  files.
- **Weaknesses**: the current scanner treats every visible `.md` as a prompt, so
  `example-01-output.md` would be scanned as a prompt; a companion directory
  whose lifecycle the app manages collides with the "delete only the selected
  `.md`" contract and with the "no app-owned sidecar" invariant; rename/move of
  the prompt must decide whether to move the companion directory; Delete must
  decide whether to remove assets. Adopting it would require a formal contract
  change to `prompts-design.md` / `prompt-specific-capabilities.md`.
- **Verdict**: **rejected** for v1. It introduces the three highest-risk changes
  (scanner rule, delete semantics, sidecar semantics) to solve a problem that
  Candidate C solves without any of them.

### Candidate C — inline example metadata + user-chosen relative asset paths

```yaml
examples:
  - name: Product image
    input: Generate a realistic product shot
    assets:
      - assets/product-reference.png
      - outputs/example-01.png
```

Actual files:

```text
prompts/product-shot.md
assets/product-reference.png
outputs/example-01.png
```

- **Strengths**: no forced companion folder; binary/large files stay ordinary
  user files; the scanner naturally ignores non-`.md` assets; the user decides
  directory organization; no app-owned sidecar is created; rename/move of the
  prompt never breaks references (they are project-relative).
- **Weaknesses to resolve explicitly**: a `.md` example output would still be
  scanned as a prompt (solved below by the non-`.md` asset rule); rename/move of
  a prompt does not move assets; asset lifecycle is separate from prompt
  lifecycle; the reference base (project root vs prompt folder) must be fixed.
- **Verdict**: **chosen**. It is the only candidate that preserves every core
  invariant with only an additive frontmatter field.

### Candidate D — package / directory-as-prompt

```text
review-pr/
  prompt.md
  examples/
  assets/
```

- **Strengths**: everything for one prompt in one folder.
- **Weaknesses**: it changes the core rule "Prompt identity = relative `.md`
  path" and forces large scanner / CRUD / Git-history / compatibility changes.
- **Verdict**: **rejected**. The issue itself expects this unless there is a
  very strong reason; there is none that Candidate C does not satisfy more
  cheaply.

## 4. Final decision

**Canonical storage model = Candidate C**, with text examples inline in
frontmatter and all files referenced by project-relative paths.

Decisions locked here:

- **Companion directory: not allowed.** Assets are user-chosen plain files;
  there is no app-created companion folder and no reserved directory.
- **Asset relative-path base: the Project root** (the same base as prompt
  identity and the `related` field). References never escape the project.
- **Scanner collision: structurally impossible.** An asset reference is
  validated to never point at a file with a `.md` extension; inline text lives
  in frontmatter, not in files. Therefore no file can be both a prompt and an
  example output, with no scanner change.
- **Sidecar contract: unchanged.** The "no app-owned hidden sidecar" invariant
  is preserved because the app creates nothing inside the project.
- **Delete contract: unchanged.** Delete Prompt removes only the `.md`; assets
  are never implicitly deleted.
- **Identity contract: unchanged.** Prompt identity stays the project-relative
  `.md` path; no UUIDs.

## 5. Canonical on-disk examples

Three realistic fixtures, one per required shape (pure text, long text, binary).

### Fixture 1 — pure text examples (inline)

```text
prompts/review-pr.md
```

```markdown
---
description: Review a pull request for regressions and missing tests.
examples:
  - name: Small PR
    input: |
      Repository: foo/bar
      PR: 9
    output: |
      Looks good; add a test for the null case.
  - name: Empty PR
    input: |
      Repository: foo/bar
      PR: 0
    output: |
      No changes to review.
---

Review the pull request for {repository} and {pr_number}.
```

### Fixture 2 — long text example as an asset file

```text
prompts/review-pr.md
examples/review-pr-large-output.txt
```

```markdown
---
description: Review a pull request for regressions and missing tests.
examples:
  - name: Large PR
    output_file: examples/review-pr-large-output.txt
    assets:
      - examples/review-pr-diff.json
---

Review the pull request for {repository} and {pr_number}.
```

`examples/review-pr-large-output.txt` holds the multi-thousand-line output;
`examples/review-pr-diff.json` is a JSON fixture. Both are ordinary user files.

### Fixture 3 — binary asset example (image / multimodal)

```text
prompts/product-shot.md
assets/product-reference.png
outputs/product-shot-01.png
```

```markdown
---
description: Generate a realistic product shot.
examples:
  - name: Reference-driven shot
    input: Generate a realistic product shot of the item.
    output: |
      See outputs/product-shot-01.png for the generated result.
    assets:
      - assets/product-reference.png
      - outputs/product-shot-01.png
---

Generate a realistic product shot of {item}.
```

The user chose the folder names (`examples/`, `assets/`, `outputs/`); none of
them is special to the app.

## 6. Frontmatter schema

`examples` is an optional, additive list field in the prompt frontmatter. YAML
frontmatter keys are snake_case; the frontend / IPC DTO is camelCase. The two
layers are mapped 1:1:

```yaml
# on-disk YAML frontmatter keys (snake_case)
examples:
  - name: Large PR
    input_file: examples/review-pr-large-output.txt
    assets:
      - examples/review-pr-diff.json
```

```ts
// TypeScript / Rust IPC DTO shape (camelCase), mirroring the issue's PromptExample
interface PromptExample {
  /** Display label only — never an identity key. May be empty, duplicate or change. */
  name?: string;
  /** Inline text input. Mutually exclusive with inputFile. */
  input?: string;
  /** Asset file holding a large input (frontmatter key: input_file). Mutually exclusive with input. */
  inputFile?: string;
  /** Inline text output. Mutually exclusive with outputFile. */
  output?: string;
  /** Asset file holding a large output (frontmatter key: output_file). Mutually exclusive with output. */
  outputFile?: string;
  /** Free-text notes for this example (like the prompt-level `notes`). */
  notes?: string;
  /** Extra asset files: images, PDFs, JSON/code fixtures, generic binaries. */
  assets?: string[];
  /** Unknown nested keys preserved across a supported edit. */
  extra?: Record<string, unknown>;
}
```

**Example identity: an example has no persistent identity in v1.** Array
position defines ordering only; `name` is a display label. All edits (insert,
remove, reorder, edit a field) write the whole `examples` array as one unit. No
ID is introduced unless a future need (deep-link, cross-prompt reference,
stable diagnostics) proves it necessary.

Validation rules (deterministic, fail-closed):

- `examples` must be a list of mappings; any other shape is a frontmatter
  warning.
- An example must carry at least one of `input` / `input_file` / `output` /
  `output_file` / `assets`; an otherwise empty example is a warning but stays
  visible.
- `input` and `input_file` cannot both be present; `output` and `output_file`
  cannot both be present (a warning otherwise; both values preserved).
- `name`, `input`, `output`, `notes` are plain strings. Multiline values
  serialize as YAML block scalars (the same path `notes` already uses).
- `input_file`, `output_file` and every `assets` entry are **asset references**
  (§7).
- Unknown nested keys inside an example are preserved in `extra`, exactly like
  `variables.<name>.<field>` today.

### Preservation of hand-written and invalid data (hard contract)

The typed `PromptExample` projection is for display and editing only. It is
**never** the authoritative on-disk representation: a supported metadata edit
that does not touch examples must not drop, normalize or "repair" any example
value the user wrote, however malformed it is.

**Semantic preservation contract** (aligned with contract invariant #9):

- Invalid or hand-written examples data must be **semantically preserved**
  across unrelated metadata edits. No example, no field, and no list item may
  be dropped, normalized or silently repaired because it failed to parse into
  the typed projection.
- Lexical formatting (key order, quoting, indentation, block style, comments)
  is **not** part of the preservation contract. Two YAML spellings with the
  same semantics are interchangeable after a save; the requirement is that the
  *values* the user wrote survive, not their exact bytes.
- The implementation must therefore carry the un-parseable parts of the
  `examples` value (the raw mapping/sequence/scalar as a `serde_yaml::Value`)
  alongside the typed projection and re-emit them on an unrelated metadata
  save. It must **not** simply truncate to `Vec<PromptExample>` — that is the
  `related` / `variables` failure mode this contract forbids.
- This guarantee is intentionally **stronger than** the current `related` /
  `variables` behavior. Those fields today parse invalid shapes into
  empty/dropped values and can lose user YAML on a subsequent dirty serialize;
  the `examples` implementation must not reuse that pattern (see §18).
- Invalid examples never hide the prompt and never block other edits.

## 7. Asset references: identity and validation

An **asset reference** is a project-relative path. Validity and resolution are
two separate layers.

**Reference syntax validity** (checked by the parser; deterministic and
fail-closed, reusing the existing prompt path machinery):

- Passes the existing prompt-relative path rules (`validate_name` in
  `store.rs`): not absolute, no `\` / `:` / NUL, no empty segments, no `.` /
  `..` segments.
- Resolves inside the project root (no path escape).
- Does not traverse a symlink and does not end at a symlink (reusing the
  existing symlink checks in `safe_relative_path`).
- Does **not have a `.md` extension** (case-insensitive). A `.md` file is a
  prompt by identity; it cannot also be an asset. This is the principled,
  non-hardcoded resolution of the scanner collision.
- Unicode paths are allowed (the codebase already round-trips Unicode prompt
  names).

A syntactically valid reference has a **resolution state**, evaluated when the
Detail view (or the asset seam) reads the filesystem:

- the path is an existing regular file → **resolved**;
- the path does not exist → **broken** (like a broken `related` entry):
  preserved and surfaced as a non-blocking "missing file" warning, never
  silently dropped and never auto-repaired;
- the path exists but is not a regular file (directory, socket, …) →
  **invalid / unsupported target**: same non-blocking warning treatment.

Cross-project references are **not allowed** in v1: an asset reference always
resolves inside the current Project root, keeping All Projects identity
isolation intact.

## 8. Scanner behavior

The scanner (`scan_prompts` / `collect` in `store.rs`) is **unchanged**. It
recursively reads visible `.md` files; dot entries and symlinked directories are
skipped; every visible `.md` remains a prompt.

Why `example-output.md` cannot accidentally become a prompt:

1. Inline example text lives in the prompt's frontmatter, not in a file, so it
   is never scanned.
2. Asset references are validated to **never point at a `.md` file**, so an
   asset cannot be a prompt by the identity rule.

No reserved directory names, no hardcoded path exclusions and no scanner
special-casing are introduced. This is the "principled, not a hack" answer the
issue requires.

## 9. Rename / Move / Delete / Duplicate / Variant semantics

### Rename / Move (prompt)

`rename_prompt` / `move_prompt` move only the `.md` file. Example references are
project-relative and therefore **remain valid automatically**: renaming
`review-pr` → `review-pull-request` does not change `assets/…` paths. No
prompting and no two-phase operation is needed. There is no companion directory
to move.

### Rename / Move (asset file)

Moving or renaming a referenced asset file is a user action. References are by
path, so after a user moves a file the reference becomes **broken** and is
surfaced as a missing-file warning in the Detail view. The app never rewrites
references and never auto-moves files.

### Delete (prompt)

`delete_prompt` removes only the selected `.md`. **Referenced assets are never
deleted**, never pruned, and there is no implicit garbage collection. Assets
orphaned by a prompt delete are ordinary user files that stay exactly where they
are. (There is deliberately no "delete assets" feature in v1; any future
ownership contract with a multi-file delete confirmation is a separate design.)

### Delete (asset file)

Deleting an asset file is a user action. Any prompt referencing it now has a
broken reference, surfaced as a missing-file warning.

### Duplicate / Duplicate as Variant

`duplicate` writes a new physical `.md`, so **inline example text is copied with
the file**. Asset **files are not copied**. The duplicated prompt's asset
references are copied verbatim and keep pointing at the existing files, which
remain valid (they still exist). A Duplicate as Variant behaves the same:
the variant is a complete, independent `.md` (per the `variantOf` contract) and
shares references to the same user-owned asset files; the files themselves are
not copied and are not marked read-only on the filesystem. No automatic asset
copy in v1.

## 10. Git semantics

- Prompt file history (existing read-only Git History) includes inline example
  text, because it lives in the `.md` frontmatter. A diff of the prompt shows
  example text changes.
- **Asset Git history is out of v1 scope.** The current Git seam is
  prompt-only (`prompt_git_context` resolves a prompt `.md` path); it cannot
  query an arbitrary asset file. Promptarium v1 shows prompt `.md` history only;
  asset file history remains available through the user's normal Git tooling
  (`git log -- path/to/asset`). A generic asset Git-history backend is deferred
  (§18) and would need a new Rust seam before it can be shown in-app.
- The app never initializes Git and never auto-commits (existing rule).
- Git dirty state: the existing dirty/conflict handling applies to the prompt
  `.md` (the only file the app writes). The app never writes asset files, so it
  never marks them dirty and never participates in their Git state.

## 11. Watcher / refresh semantics

The current watcher (`watcher.rs`) triggers a debounced refresh for Markdown
files and directory changes; non-`.md` file events are otherwise filtered out.
v1 boundary (requires one small watcher change — see §18):

- **Extend Create handling so non-`.md` file creation refreshes.** The current
  implementation filters a normal `Create(File, foo.png)` because
  `path_triggers_refresh` only accepts directories and `.md` files. The
  follow-up change makes a created non-`.md` file refresh, so a newly added
  asset appears automatically. Remove / Rename already refresh regardless of
  extension (the `event_relevant` remove/rename special-case), so a deleted
  asset already clears; that behavior is kept.
- **Continue ignoring content `Modify` of non-`.md` files.** Editing an asset
  (e.g. saving an image edit) must not trigger a library refresh; a large asset
  directory must not cause event storms.
- The Detail view also re-checks asset existence on open and on explicit
  Refresh, so a stale missing-file badge clears when the file reappears.
  Explicit Refresh remains the correctness path in every case.

## 12. All Projects semantics

- Prompt identity stays project-scoped (project path + relative `.md` path).
  Two prompts with the same name in different projects remain distinct.
- Asset references cannot cross projects (they resolve inside the current
  Project root), so identity cannot leak between projects.
- All Projects search does not search example text in v1 (see §13).

## 13. Search / Health / Compare / History — explicit boundaries

- **Search**: example text (inline input/output/notes) is **not** searchable in
  v1. Search semantics (name / relative path / tags / description / models /
  body) are unchanged, so existing ranking and results are stable. Indexing
  inline example text is a small, additive follow-up if it proves valuable.
- **Health**: v1 adds **no** new Health findings. Broken / missing asset
  references are surfaced as a non-blocking warning in the Detail Examples
  section, not as a Needs Attention finding. (A deterministic
  `BROKEN_EXAMPLE_ASSET` finding mirroring the `related` pattern is a candidate
  future extension, deliberately out of v1 scope.)
- **Compare**: `examples` participates in the Compare metadata diff in the
  follow-up implementation (a small, deterministic addition to `diffMetadata`).
  Compare still never writes anything back.
- **History**: inline example text is part of prompt history (see §10); asset
  file history is not shown in-app in v1 — it stays available through normal
  Git tooling.

## 14. Compatibility and migration

- Existing prompts without `examples` are unchanged: the field is absent, and
  no migration or rewrite occurs on open.
- A hand-written `examples` key today is an unknown field and already round-trips
  through `metadata.extra` (invariant #9). After the feature lands, the same key
  is parsed into the typed field; the lexical layout is not part of the
  preservation contract.
- Invalid `examples` shapes warn but never hide the prompt, never get silently
  repaired, and their values are semantically preserved across a supported
  metadata save (§6). This preservation guarantee is explicit and
  intentionally **stronger than** the current `related` / `variables` handling,
  which warns on invalid shapes but does not currently retain the raw values
  (§18).
- Because the model is additive and file-based, no database migration and no
  rewrite of existing libraries are required.

## 15. UX sketch

Follows the `prompt-specific-capabilities.md` UX principles: prompt-specific
information appears as a section inside the existing Preview/Inspector, never as
a permanent tab.

```text
Preview

Prompt body

Variables
Related
Usage Notes
Needs Attention
Examples (3)
  ├ Example: Small PR
  │   Input
  │   Output
  │   Assets (1)
  ├ Example: Large PR
  │   Input
  │   Output (from examples/review-pr-large-output.txt)  [missing file warning if broken]
  └ Example: Reference-driven shot
      Input
      Output
      Assets (2)
```

- v1 displays examples **read-only**; editing is a follow-up feature.
- Order is the frontmatter array order.
- A missing/broken asset shows an inline, non-blocking warning with the relative
  path; it never blocks the prompt.
- Large inline output is truncated with an expand control.
- Asset names are clickable to Reveal in Finder via a **new Rust asset seam**
  (`reveal_asset_in_finder(project, relative_path)`), not the existing
  prompt-only `reveal_in_finder` (which appends `.md`). The new seam validates
  the path per §7 (project-root, escape, symlink, non-`.md`) and reveals the
  real file. The frontend never constructs absolute paths (§18, Issue B).

## 16. Rejected alternatives and reasons

| Alternative | Why rejected |
|---|---|
| A as the complete model | Cannot express binary; large outputs bloat frontmatter. Kept only as the text layer of C. |
| B — companion directory | Violates "delete only selected .md", "no app-owned sidecar", and needs a scanner rule change. Three high-risk contract changes for no benefit over C. |
| D — directory-as-prompt | Breaks "identity = relative .md path"; forces large scanner/CRUD/Git/compat changes. |
| UUID example identity | v1 examples have no persistent identity: array position defines ordering only and edits rewrite the whole array. No deep-link / cross-prompt reference / stable-diagnostics need exists yet; introduce an ID only when one of those needs is proven. Consistent with the no-UUID principle. |
| `.md`-suffixed assets | Would collide with the scanner; rejected by the non-`.md` asset rule instead of a special-case. |
| App state in `~/.promptarium` for examples | Violates "the real file is the single source of truth"; all example data lives in the `.md` + asset files. |
| Database / object storage / cloud upload | Explicit non-goals; contradicts local-first. |

## 17. Contract impact

`prompt-specific-capabilities.md` needs an **additive** update: `examples`
joins the reserved frontmatter fields (`variables`, `related`, `variantOf`,
`notes`) with the semantics defined here. No existing invariant is weakened:
- identity (relative `.md` path) — unchanged;
- no UUID — unchanged;
- no app-owned hidden sidecar — unchanged (no companion dir, app creates
  nothing);
- delete only selected `.md` — unchanged;
- scanner treats every visible `.md` as a prompt — unchanged.

`prompts-design.md` needs a short pointer to this design doc (the way it already
points to `prompt-specific-capabilities.md`).

## 18. Follow-up implementation issues

The spike deliberately produces **no production code**. Recommended split:

1. **Issue A — Rust `examples` field**: parse / validate / serialize `examples`
   in `store.rs`. This must implement the §6 preservation contract: keep the
   un-parseable parts of the `examples` value (as a raw `serde_yaml::Value`)
   alongside the typed projection and re-emit them semantically on an unrelated
   metadata save; never drop or project-truncate invalid content; lexical
   formatting is not preserved. Do **not** copy the `related` / `variables`
   handling, which currently warns but drops invalid shapes. Add Rust tests
   including "invalid shape → edit unrelated metadata → all original example
   values/items remain semantically intact".
2. **Issue B — Detail display (read-only)**: TypeScript mirror in `types.ts`
   (camelCase DTO), the Examples section in the Preview inspector, missing-asset
   warning, and a new Rust seam `reveal_asset_in_finder(project, relative_path)`
   (validated per §7) so asset names can be revealed. `reveal_in_finder` stays
   prompt-only.
3. **Issue C — Examples editor (later)**: edit examples in Edit mode, add assets
   via the native file dialog with path validation, and insert/remove/reorder
   examples. Every edit writes the whole `examples` array as one unit; an
   explicit edit is the only operation that replaces the raw value with a
   freshly generated typed structure.
4. **Small watcher change (Issue B or separate)**: extend Create handling so
   non-`.md` file creation refreshes; existing Remove/Rename already refresh
   regardless of extension, and non-`.md` content Modify stays ignored (§11).
5. **Deferred, only if proven valuable**: indexing inline example text in
   search; a `BROKEN_EXAMPLE_ASSET` Health finding; including assets in
   Compare; a generic asset Git-history backend with its own Rust seam; a
   hardening pass to give `related` / `variables` the same raw-preservation
   guarantee `examples` now has.

## 19. Regression / verification matrix

Because this is a Design Spike, no new production runtime tests are added. The
final model must be provable by tests; the matrix below is the contract the
follow-up issues must lock:

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | Plain prompt, no examples | Unchanged; no `examples` field written. |
| 2 | Text-only example parse/save | Inline input/output round-trip; block scalars preserved. |
| 3 | Large output | Via `output_file`/`assets`; no frontmatter bloat. |
| 4 | Missing asset | Broken reference, warning in Detail, never dropped. |
| 5 | Unicode asset path | Valid; resolves and round-trips. |
| 6 | Path escape rejection | `../outside` rejected, fail-closed. |
| 7 | Symlink boundary | Symlinked asset ref rejected. |
| 8 | `.md` asset rejection | Asset ref with `.md` extension → warning, never a prompt. |
| 9 | Invalid examples shape preservation | Non-list / non-mapping item / wrong-typed field / both `input`+`input_file` → warned, and all original values/items remain semantically intact after an unrelated metadata save. |
| 10 | Prompt rename | Example refs stay valid. |
| 11 | Prompt move | Example refs stay valid. |
| 12 | Prompt delete | Assets not deleted; orphaned files remain. |
| 13 | Duplicate | Inline examples copied; assets not copied; refs valid. |
| 14 | Duplicate as Variant | Same as duplicate; variant is an independent `.md`. |
| 15 | All Projects same-name prompts | Identity stays project-scoped. |
| 16 | External asset create/delete | Non-`.md` Create/Remove triggers refresh; new asset appears, removed asset clears. |
| 17 | External asset content edit | No library refresh; Detail re-checks on open / explicit Refresh. |
| 18 | Git dirty/history | Prompt `.md` dirty/conflict handling unchanged; examples text part of prompt history; asset history not shown in-app, available via Git tooling. |
| 19 | Scanner collision | No `.md` file can be both a prompt and an asset. |

Merge gates (unchanged by this spike, must keep passing):
`pnpm check`, `pnpm test:smoke`, `pnpm build`, `cargo test --lib`.

## 20. Acceptance checklist

- [x] Candidates A / B / C / D all analyzed (§3).
- [x] A single canonical storage model chosen (§4).
- [x] Three real on-disk fixtures: pure text, long text, binary (§5).
- [x] Companion directory: not allowed (§4).
- [x] Asset relative-path base: project root (§7).
- [x] Scanner avoids example `.md` misidentification (§8).
- [x] Rename / Move / Delete / Duplicate / Variant semantics defined (§9).
- [x] "No in-project sidecar" contract unchanged, and why (§17).
- [x] Watcher boundary for non-`.md` assets defined (§11).
- [x] Whether examples enter search / health / compare / history — explicit (§13).
- [x] Invalid examples preservation contract (semantic, no data loss) defined and stronger than `related` / `variables` (§6).
- [x] v1 example identity = none; array position = ordering only (§6).
- [x] No production feature code introduced by this spike.
