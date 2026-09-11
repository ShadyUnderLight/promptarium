# Promptarium

[![CI](https://github.com/ShadyUnderLight/promptarium/actions/workflows/ci.yml/badge.svg)](https://github.com/ShadyUnderLight/promptarium/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ShadyUnderLight/promptarium)](https://github.com/ShadyUnderLight/promptarium/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

Promptarium is a local-first **Prompt Library** for macOS: a project-based
Markdown vault for browsing, editing, tagging, favoriting and organizing large
prompt collections.

A **project** is a real folder on disk. A **prompt** is a normal `.md` file
identified by its path relative to that folder. The filesystem is the source of
truth — there is no required database, cloud account, AI API key or
Accessibility permission, and nothing the app owns is ever written into your
project folders.

Promptarium **manages** prompts. It is not a prompt execution, chat, playground
or deployment platform: it never calls a model and never injects text into
another application.

## Core features

**Library**

- **Multi-project sidebar** with per-project colors, rename, Reveal in Finder
  and Forget (forgetting never deletes files).
- **Smart Views** — All prompts, Needs Attention, Favorites, Draft, Archived —
  combined with the active project's real folder tree and derived tag counts.
- **Search** over filename, relative path, description, tags, model hints and
  body, per project or across **All Projects**. Name/path matches rank above
  metadata, which ranks above body matches.
- **Sort & view modes** — name A–Z / Z–A, modified newest/oldest, favorites
  first; list and compact grid.
- **Resizable three-pane workspace** with remembered pane widths.

**Prompt management**

- Create, rename, move, duplicate, duplicate-as-variant and delete prompts, plus
  create / rename / delete empty folders. Every write is atomic (temporary
  sibling + rename); delete removes only the selected `.md` file.
- **Multi-select batch toolbar** — add/remove tags, set status, favorite /
  unfavorite, delete. Each file write is independent and partial failures report
  the exact paths that failed.
- **Copy Prompt** copies the body only, never the YAML frontmatter. When the body
  contains `{name}` variables it first opens a fill form, copies the rendered
  result, and leaves the file untouched.

**Content & metadata**

- Optional YAML frontmatter: `description`, `tags`, `status`
  (`draft` / `active` / `archived`), `favorite`, `models`, `created`.
  Plain Markdown files without frontmatter load unchanged — zero migration.
- **Unknown YAML fields are preserved**, including their exact value types, on
  every supported metadata save.
- **Variables** — `{name}` placeholders are detected, listed and annotated via a
  single frontend parser; `{{name}}` escapes. **Copy Prompt** opens a fill form
  when variables are present: values you type are substituted for this copy only,
  a blank field removes the variable, and the Prompt file is never modified.
- **Related prompts** with derived backlinks, **variant families**
  (`variantOf`), **usage notes**, and **examples** with inline text or
  project-relative input/output/asset file references.
- **Needs Attention** (health) — malformed frontmatter, empty bodies,
  undocumented or stale variables, broken / invalid / self relations, variant
  parent problems and variant cycles. Always derived and read-only.

**Inspection**

- **Preview | Edit | History** inspector. Preview renders headings,
  paragraphs, lists, blockquotes, fenced code, inline code, tables, links and
  rules.
- **Conflict-aware saving** — a save is rejected with Reload / Keep editing if
  the file changed on disk while you were editing. Invalid frontmatter stays
  visible with a warning and is never silently repaired.
- **Compare…** — a temporary body + metadata diff against another prompt in the
  same project.
- **History** — read-only Git commit history and per-commit diffs for the
  selected prompt. Git is detected but never initialized, and edits are never
  auto-committed.

**App**

- **Filesystem watcher** keeps the library in sync with external edits; Refresh
  and window focus are always available as fallbacks.
- **Localization** — English and 简体中文, following the system language by
  default.
- **Light / dark theme** following the OS, with a manual override.
- **Self-update** from GitHub Releases for signed desktop builds.

## Install

### End users

Download the installer for your platform from
[GitHub Releases](https://github.com/ShadyUnderLight/promptarium/releases).
macOS is the primary target; CI also produces Linux and Windows bundles.

Builds are unsigned, so the first launch may warn:

- **macOS** — right-click the app → **Open**, then confirm.
- **Windows** — SmartScreen may prompt; choose **More info** → **Run anyway**.

Installed copies update themselves in-app.

### From source

Requirements:

- **Node.js** `^20.19.0` or `>=22.12.0` (Vite 8 requirement) and **pnpm 11** —
  `corepack enable && corepack prepare pnpm@11.9.0 --activate`.
- A current **stable Rust** toolchain (`rustup`); the crate targets Rust edition
  2021.
- **macOS**: Xcode Command Line Tools — `xcode-select --install`.
  **Linux**: WebKitGTK 4.1 and the usual Tauri dependencies —
  `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  build-essential libssl-dev libxdo-dev libasound2-dev`.

```sh
git clone https://github.com/ShadyUnderLight/promptarium.git
cd promptarium
pnpm install
```

## Run

```sh
pnpm dev        # browser preview at http://localhost:1420 (in-memory sample library)
pnpm tauri dev  # native desktop app
```

The browser preview has no filesystem access — it exercises the same library
flows against a seeded in-memory fixture, so UI work is possible without
building the Rust shell.

## Build

```sh
pnpm build       # frontend only → build/ (static SPA)
pnpm preview     # serve the production frontend
pnpm tauri build # native app + installers → src-tauri/target/release/bundle/
```

Releases are cut by pushing a version tag (`v*`), which triggers
`.github/workflows/release.yml` to build and attach signed installers plus the
updater manifest.

## Basic usage

1. **Add a project** — click **Add project** in the sidebar, type a folder path
   or use **Browse**, then **Add**. The folder's basename becomes the label and
   the project becomes active. Every `.md` file inside is now a prompt;
   subfolders become the folder tree.
2. **Browse** — the middle pane lists prompts; the left sidebar filters by
   Smart View, folder, tag or project; the header search field searches the
   current scope, or every registered project when **All Projects** is selected.
3. **Inspect** — single-click a prompt to open it in the right-hand
   **Preview** pane. Variables, Related, Usage Notes, Examples and Needs
   Attention appear as sections below the body.
4. **Edit** — switch to **Edit**, change the Markdown body or metadata, then
   `Cmd+S` (or **Save changes**). A dirty indicator is always visible;
   navigating away asks before discarding.
5. **Copy** — **Copy Prompt** puts the body on the clipboard without the
   frontmatter, so it can be pasted straight into any model. If the body uses
   `{name}` variables, a form appears first: fill what you need, leave the rest
   blank, then **Copy final Prompt**.

### Prompt file format

Any Markdown file is a valid prompt. Frontmatter is optional and additive:

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

variables:
  repository:
    description: Repository name or URL
    example: ShadyUnderLight/promptarium
  pr_number:
    description: Pull request number
    example: "9"

related:
  - coding/github/fix-pr

variantOf: coding/github/review-pr

notes: |
  Works best for normal-sized pull requests.

examples:
  - name: Small PR
    input: |
      Repository: ShadyUnderLight/promptarium
      PR: 9
    output: Looks good; add a test for the null case.
---

Review {repository} pull request #{pr_number}.
```

| Field | Type | Meaning |
| --- | --- | --- |
| `description` | string | Shown in the list and the detail header. |
| `tags` | string[] | Tag counts are derived from files; there is no tag registry. |
| `status` | `draft` \| `active` \| `archived` | Drives the Draft / Archived Smart Views. |
| `favorite` | boolean | Drives the Favorites Smart View and sort order. |
| `models` | string[] | Model hints used by the model filter. |
| `created` | `YYYY-MM-DD` | Display only. A prompt's *modified* time always comes from the filesystem. |
| `variables` | map | Annotates `{name}` variables only — it can never create one, and a stale annotation is preserved rather than dropped. |
| `related` | string[] | Project-relative prompt paths (no `.md`). Backlinks are derived, never stored. |
| `variantOf` | string | Project-relative parent path. Relationship only — no inheritance or metadata merging; a variant is a complete, independent prompt. |
| `notes` | string | Usage notes outside the body. Never copied by **Copy Prompt**. |
| `examples` | list | `name`, `input` / `input_file`, `output` / `output_file`, `notes`, `assets` (project-relative). |

The relative path — not frontmatter — defines a prompt's folder and identity,
so a prompt is addressed as `coding/github/review-pr`. No UUIDs, no sidecars.

## Configuration

### App data directory

App-owned state and disposable indexes live in **`~/.promptarium`** — never
inside a user project. Deleting it never loses a prompt; the next scan rebuilds
everything from Markdown.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROMPTARIUM_DATA_DIR` | `~/.promptarium` | Overrides the data root (used by tests). A blank value is ignored. |

The project roster is stored there as `prompts-state.json`:

```json
{
  "projects": [{ "name": "Work", "path": "/Users/me/Prompts/Work", "color": "blue" }],
  "active": "/Users/me/Prompts/Work"
}
```

Paths are canonicalized before registration, and re-registering a path updates
its label instead of adding a duplicate. A **missing** state file means a fresh
install; a **corrupt** one is a loud error, never a silent reset.

### Interface preferences

Browser-local, per-machine preferences — no account, no sync:

| Key | Values | Purpose |
| --- | --- | --- |
| `promptarium-theme` | `light` \| `dark` | Theme override; falls back to `prefers-color-scheme`. Applied before first paint. |
| `promptarium-locale` | `system` \| `en` \| `zh-CN` | Interface language. |
| `prompt-library-ui` | JSON | Pane widths, sort order and list/grid view mode. |
| `promptarium-update-seen` | version string | The update banner shows a given version at most once; the footer keeps it reachable. |

### Build & release configuration

- `src-tauri/tauri.conf.json` — window, bundle metadata, and the updater
  endpoint plus signing public key.
- `src-tauri/capabilities/default.json` — the Tauri permission set granted to
  the main window (opener, dialog, updater, process restart).
- `.github/workflows/release.yml` — reads the `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets; without them updater artifacts
  cannot be signed and installed copies will reject the update.

## Project structure

```text
Promptarium/
├── src/                              # SvelteKit frontend (static SPA, ssr = false)
│   ├── app.html                      # shell + pre-paint theme bootstrap
│   ├── app.css                       # single global stylesheet (light/dark tokens)
│   ├── routes/                       # +layout.svelte, +page.svelte (SPA shell + footer)
│   └── lib/
│       ├── api.ts                    # typed bridge to the Tauri command seam (+ browser fixture)
│       ├── library.svelte.ts         # library state, filters, selection, CRUD orchestration
│       ├── copy.ts                   # body-only clipboard renderer
│       ├── theme.ts                  # light/dark preference
│       ├── updater.svelte.ts         # self-update state machine
│       ├── components/
│       │   ├── PromptsView.svelte    # three-pane workspace shell
│       │   └── library/              # sidebar, list, detail, editor, dialogs, compare, history…
│       ├── i18n/                     # en / zh-CN catalogs, t() / tPlural()
│       ├── library/                  # search index, scope, visible filter, refresh scheduling
│       ├── prompts/                  # types, compare, diff-lines, duplicate, history, toasts
│       ├── relations/                # related prompts and backlinks
│       ├── variants/                 # variant family resolution
│       ├── health/                   # Needs Attention findings
│       ├── variables/                # the one variable grammar — {name} parsing and copy spans
│       ├── examples/                 # examples editor helpers
│       └── attachments/              # focus trap
├── src-tauri/                        # Tauri 2 desktop shell (Rust)
│   ├── src/
│   │   ├── main.rs / lib.rs          # entry point and command registration
│   │   ├── datadir.rs                # ~/.promptarium resolution (PROMPTARIUM_DATA_DIR)
│   │   └── prompts/
│   │       ├── state.rs              # registered-project command boundary
│   │       ├── store.rs              # frontmatter parser, scanner, safe file operations
│   │       ├── appstate.rs           # app-local project registration
│   │       ├── watcher.rs            # filesystem watcher
│   │       └── git.rs                # read-only Git history / diff
│   ├── capabilities/default.json     # Tauri permissions
│   ├── icons/                        # bundle icons
│   └── tauri.conf.json               # window, bundle, updater configuration
├── tests/                            # 17 .mjs contract scripts + 13 Vitest suites
├── project_docs/                     # engineering, interaction and migration contracts
├── static/                           # favicon
├── build/                            # adapter-static output (gitignored)
├── .github/workflows/                # ci.yml (push/PR to main), release.yml (v* tags)
├── CONTRIBUTING.md                   # stack, source layout and conventions
└── package.json                      # scripts, pnpm 11, MIT license
```

Architecture in one line: **Rust owns the filesystem** — the project roster,
frontmatter parsing, path validation and every operation that can write user
data — while **Svelte owns rendering, UI state and the single variable
grammar**. The frontend never sends an arbitrary destination to a generic
writer.

## Verify

```sh
pnpm check                         # svelte-kit sync + svelte-check
pnpm test:smoke                    # 17 .mjs contract scripts + Vitest component/i18n suites
pnpm build                         # production frontend build
cd src-tauri && cargo test --lib   # Rust unit tests
```

Run all four before committing — the same four run in CI on every push and PR to
`main`, plus a `git diff --check` whitespace guard on pull requests.

Read `project_docs/prompts-design.md` (storage and command seam),
`project_docs/prompts-ux.md` (interaction contract) and
`project_docs/prompt-specific-capabilities.md` (field semantics and invariants)
before changing storage or interaction behavior.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the stack, setup, source layout and
the rules that keep this project Markdown-native.

In short:

- Existing plain Markdown keeps working with zero migration.
- Every new frontmatter field is optional and additive, and reading never
  rewrites a file.
- Unknown YAML fields round-trip; prompt bodies are never normalized, trimmed or
  reflowed.
- Nothing app-owned is written inside a user project — no UUIDs, no sidecars, no
  authoritative database.
- Forgetting a project removes its registration only.

Changes should pass `pnpm check`, `pnpm test:smoke`, `pnpm build` and
`cargo test --lib`.

## License

MIT © 2026 ShadyUnderLight. See [package.json](package.json) for the license
declaration.
