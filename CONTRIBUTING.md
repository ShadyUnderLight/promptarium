# Contributing

## Stack

- Frontend: SvelteKit, Svelte 5 and TypeScript, built as a static SPA.
- Desktop shell: Tauri 2 and Rust.
- Prompt storage: ordinary Markdown files with optional YAML frontmatter.
- Package manager: pnpm.

Rust owns the registered-project roster, frontmatter parsing and every
filesystem operation that can write user data. The frontend owns rendering, UI
state, Markdown preview and the one variable grammar in
src/lib/variables/variables.ts.

## Setup and run

    pnpm install
    pnpm dev       # browser preview with seeded in-memory projects
    pnpm tauri dev # native desktop app

The browser preview has no filesystem access; it exercises the same library
flows against an in-memory fixture.

## Verify

Run all four checks before committing:

    pnpm check
    pnpm test:smoke
    pnpm build
    cd src-tauri && cargo test --lib

## Where things live

- src/lib/components/library/ — project sidebar, prompt list, detail,
  Markdown preview, editor and dialogs.
- src/lib/library.svelte.ts — library state, filters, selection, CRUD
  orchestration and remembered UI preferences.
- src/lib/api.ts and src/lib/prompts/types.ts — the TypeScript mirror of the
  Tauri command seam.
- src/lib/variables/variables.ts — the only variable parser, retained for prompt
  inspection and copy behavior.
- src-tauri/src/prompts/store.rs — frontmatter parser, scanner and safe file
  operations.
- src-tauri/src/prompts/appstate.rs — app-local project registration.
- src-tauri/src/prompts/state.rs — registered-project command boundary.
- project_docs/ — the engineering, interaction and migration contracts.

Read project_docs/prompts-design.md and project_docs/prompts-ux.md before
changing storage or interaction behavior. User prompt folders must remain
portable outside this application: do not add UUIDs, sidecars, cloud metadata
or an authoritative database.
