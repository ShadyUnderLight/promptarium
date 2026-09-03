# Prompt Library — Engineering Contract

This document describes the storage, parsing, native command seam and derived
state for the Prompt Library. The app is a local-first viewer/editor over files
the user owns; it is not a prompt execution service.

## Source of truth

The data model is deliberately small:

```text
Application
└── Projects (app-local registration)
    └── Project (a real folder)
        ├── Folders
        └── Prompts (real .md files)
```

The project path is its identity. A prompt is identified by its /-separated
relative path without .md, for example coding/github/review-pr. There are no
UUIDs in prompt files and no app-owned sidecars inside a project. Forgetting a
project only removes its registration; it never deletes the folder.

The project folder is canonical user data. The app may perform an explicitly
requested prompt or folder operation, but opening, scanning, indexing and
forgetting a project must not create or modify files inside it.

App-owned derived state lives under ~/.promptarium (or the
PROMPTARIUM_DATA_DIR test override): registered projects, the active path,
UI preferences and disposable indexes. Deleting derived state must never lose a
prompt; the next scan rebuilds it from Markdown.

## Prompt-specific capabilities contract

The reserved data format for the next phase — the `variables`, `related`,
`variantOf` and `notes` frontmatter fields — and the invariants those
capabilities must preserve are defined in prompt-specific-capabilities.md.
Prompt-specific user data follows the same filesystem-truth rule as everything
else here: the real `.md` file in the user's Project is the single source of
truth, and nothing under ~/.promptarium may become a second source of truth for
it.

## Prompt Markdown format

Existing files with no frontmatter remain valid and are loaded unchanged. Their
entire content is the body and metadata uses these defaults:

```text
description = ""
tags = []
status = active
favorite = false
models = []
created = unknown
```

New metadata is optional YAML frontmatter at the beginning of a file:

```markdown
---
description: Review a pull request for regressions and missing tests.
tags:
  - coding
  - review
status: active
favorite: true
models:
  - ChatGPT
created: 2026-08-28
---

Review the pull request for {repository} and {pr_number}.
```

Supported fields are description: string, tags: string[],
status: draft | active | archived, favorite: boolean, models: string[] and
created: YYYY-MM-DD. The relative path, not frontmatter, defines the folder
and identity. updated is never written; the UI uses filesystem modification
time.

Unknown YAML fields are retained in the parsed document and are emitted again
when supported metadata is saved. The serializer is deterministic, but the body
is not normalized: no automatic trimming, wrapping, newline conversion or code
fence rewriting is allowed.

Invalid frontmatter does not hide a prompt. The scanner returns the file with a
warning, the raw file remains viewable, and the app never repairs it silently.
An explicit metadata save may replace the malformed header; a read or ordinary
body refresh must not do so.

## Variables

src/lib/variables/variables.ts is the only variable parser. Rust treats the body
as opaque text and must not grow a second implementation. {name} uses the
existing [A-Za-z0-9_-]+ grammar, {{name}} escapes it, and repeated names are
one variable. The prompt detail view derives and displays the names with this
same parser. Copying a prompt body continues to use the existing frontend copy
renderer; YAML frontmatter is never copied.

## Scanner and derived index

scan_project recursively reads visible .md files and returns summaries:
relative path, display name, folder, parsed metadata, filesystem mtime and
frontmatter diagnostics. Full bodies are loaded by read_prompt for the selected
detail and by the bounded background index pass for search/count derivation.

The library keeps a per-project disposable lexical index outside reactive UI
state. It reads bodies in a bounded background pass after the summary scan, so
typing a query does not rescan every Markdown file. A body is still loaded into
the detail pane only for the selected prompt; the index stores lowercase search
text and variable counts only for the active library session.

Scanning rules are fail-closed:

- a missing or non-directory project is a visible error, never an empty library;
- unreadable Markdown files are logged and skipped so one bad file cannot hide
  the rest;
- dot entries and directory symlinks are skipped;
- every relative path is validated against the registered project root;
- writes use a temporary sibling and atomic rename;
- delete removes only the selected .md file and never prunes its folder.

Search is deterministic lexical search over relative path/name, tags,
description, model hints and body. Name/path matches rank above metadata, which
ranks above body matches. Search is a filter, not a requirement for the library
to appear. The index is disposable and no model or AI/API key is needed.

## App-local project state

prompts-state.json remains outside user projects:

```json
{
  "projects": [{ "name": "Work", "path": "/Users/me/Prompts/Work", "color": "blue" }],
  "active": "/Users/me/Prompts/Work"
}
```

Paths are canonicalized before registration. Re-registering a path changes its
label rather than creating a duplicate. A missing state file means a fresh
install; a corrupt existing state file is a loud error, never a silent reset.

## Native command seam

Rust owns path validation and all dangerous filesystem operations. The frontend
never sends an arbitrary destination to a generic writer. The MVP seam is:

```text
list_projects() -> ProjectList
add_project(name, path) -> Project
rename_project_label(path, name) -> Project
replace_project_path(old_path, new_path) -> Project
set_project_color(path, color) -> Project
remove_project(path)
set_active_project(path)

scan_project(project) -> PromptSummary[]
read_prompt(project, name) -> PromptDocument
create_prompt(project, name, body, metadata) -> PromptDocument
save_prompt(project, name, body, metadata, frontmatter_prefix, metadata_dirty)
rename_prompt(project, name, new_name) -> PromptDocument
move_prompt(project, name, destination) -> PromptDocument
delete_prompt(project, name)

create_folder(project, folder)
rename_folder(project, folder, new_folder)
delete_empty_folder(project, folder)
reveal_in_finder(project, name?)
search_prompts(project, query) -> PromptSummary[]
```

Git history is a later read-only phase. Git is detected but never initialized
and edits are never auto-committed.

## External edits and conflicts

The app refreshes on window focus and on explicit Refresh. Each refresh rebuilds
the search index from this round's body reads — no on-disk mtime/size identity
is used to reuse or skip a body — so search, variable counts and Health always
reflect the current content. A selected document is re-read before save; Rust
compares the full current file text against the `expectedRaw` the editor loaded,
and if it changed while editing, saving is rejected with a conflict; the UI
offers Reload or Keep editing. Explicit Refresh while dirty asks whether to
Reload from disk or Keep editing, so it never replaces the editor buffer
silently. A deleted or renamed external file is reflected after refresh, with a
file-missing notice while the editor holds unsaved edits.

## Removed old assumptions

The horizontal project-tab assembly UI is no longer the main information
architecture. Tags are not removed: they are now optional frontmatter metadata
and are derived from files. In-app editing, delete, rename, move and metadata
management are first-class operations. The old variable parser remains only as
the reusable variable grammar; legacy UI-specific behavior is not a required
library workflow.
