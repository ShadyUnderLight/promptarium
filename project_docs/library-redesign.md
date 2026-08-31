# Prompt Library redesign and migration notes

## What changes

Prompt Compose is being rebuilt as a local-first Prompt Library / Prompt Vault:
projects are real folders, prompts are Markdown files, and the primary workflow
is browse → inspect → edit/manage → optionally copy. The main UI is now a
resizable three-pane library with project navigation, smart views, folders,
tags, search and a prompt inspector.

## Preserved invariants

- the filesystem is the canonical prompt store;
- project path is project identity;
- relative Markdown path is prompt identity;
- application state and disposable indexes stay outside project folders;
- path validation, symlink/dot-directory rules, loud missing-folder errors and
  atomic writes remain enforced by Rust;
- the existing TypeScript variable grammar remains the only variable parser;
- projects are never deleted when forgotten.

## Intentionally replaced assumptions

The old product treated the complete Markdown file as opaque prompt content and
centered a compose box. The new product accepts optional YAML frontmatter,
supports tags/status/favorite/model hints, edits Markdown in-app, and uses a
library browser as its primary surface. The old compose box, insertion matcher,
voice-dictation controls and semantic-search model path were removed from the
desktop product because they only served the retired compose workflow. Variable
parsing is retained for prompt inspection and copy.

## File compatibility

An existing file such as coding/review.md with plain Markdown loads as an
active, non-favorite prompt with empty metadata. It is not migrated or rewritten
on open. Frontmatter is added only when a user explicitly saves metadata or
creates a prompt with metadata. Unknown fields are retained. Invalid frontmatter
stays visible with a warning until an explicit save repairs/replaces it.

## Delivery phases

1. Contract and document model: parse frontmatter, return summaries/documents,
   and implement safe CRUD.
2. Library shell: project sidebar, folder/tag navigation, prompt list/detail,
   remembered pane widths and empty/error states.
3. Preview/editor: Markdown rendering, metadata controls, explicit save,
   conflict-aware refresh and prompt operations.
4. Search and batch management: lexical search across body/metadata, combined
   filters, sort/view modes and safe per-file batch writes.
5. Git history: read-only file history and diffs only after the core library is
   stable. No automatic Git initialization or commits.

After the first pushed baseline, the hardening pass made document identity
explicit across asynchronous reads and mutations, isolated batch selection by
project, added a bounded local search/variable-count index, and made missing
project relocation replace the existing registration. These are correctness
guards, not new product scope.

The migration is additive at the file level: no database migration and no
automatic rewrite of existing prompt libraries are required.

## Replaced tests

The former compose-box/contenteditable smoke vectors were intentionally removed
with that UI. They are replaced by variable grammar/copy/span vectors and Rust
tests for frontmatter, plain-file compatibility, path safety, CRUD, search,
folder discovery and external-save conflict handling.
