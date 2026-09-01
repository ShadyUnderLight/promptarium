# Prompt-specific Capabilities — Contract (Phase 0)

Promptarium has completed the core local-first Prompt Library: a Project is a
real folder, a Prompt is a real `.md` file identified by its relative path,
Git History and incremental indexing exist, the Filesystem Watcher keeps the
library in sync, and All Projects search spans the whole vault.

The next phase moves the product from "a Markdown library that manages prompts"
toward "a Prompt Knowledge Base that understands prompt structure and
relationships" (Variable Contracts, Related prompts, Health, Variants, Notes,
Examples). Before any of those land, this document locks the data boundaries,
identity rules, compatibility guarantees and UX principles they must obey, so
no future feature breaks the existing Markdown-native / filesystem-first
design.

This document defines the contract only. It implements no new fields and
changes no runtime behavior. Later items on the Prompt-specific roadmap
reference and must obey it.

## Invariants that must be preserved

1. A Project keeps its real absolute directory path as its identity.
2. A Prompt keeps its Project-relative path without `.md` as its identity.
3. Prompts never receive a UUID.
4. No authoritative SQLite / database is introduced.
5. No app-owned hidden sidecar is written inside a user Project.
6. `~/.promptarium` holds only app state and disposable derived index data; it
   must never become the single source of truth for user Prompt-specific data.
7. Existing plain Markdown files keep working with zero migration.
8. Every new frontmatter field is optional and additive; reading never
   rewrites the file.
9. Unknown YAML fields must continue to round-trip untouched.
10. Prompt bodies are never automatically normalized, trimmed, reflowed or
    rewritten.
11. Rust continues to own dangerous filesystem / path validation; TypeScript
    remains the only implementation of the variable grammar.
12. Promptarium remains a Prompt Knowledge Manager, not a Prompt
    execution / chat / playground / deployment platform.

## Reserved data format for the next phase

Only the contract is defined here; not every field has to be implemented at
once. The target format:

```yaml
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
  - coding/github/review-checklist

variantOf: coding/github/review-pr

notes: |
  Works best for normal-sized pull requests.
  Ask for exact file/line references when possible.
---

Review {repository} pull request #{pr_number}.
```

### Field semantics

- `variables`: documents `{name}` variables that actually exist in the body.
  It cannot define a runtime variable that does not appear in the body.
- `related`: a list of Prompt relative paths inside the current Project.
- `variantOf`: the relative path of a parent Prompt inside the current Project.
- `notes`: usage notes that are not part of the Prompt body; Copy Prompt does
  not copy them.

`schemaVersion` is deliberately not introduced yet. All fields are optional;
files without any of them are always valid.

## Identity / portability rules

The first version of Prompt relation fields only accepts:

```text
a Project-relative prompt path (without .md), within the current Project
```

for example:

```yaml
related:
  - coding/github/review-pr
```

The following must never be written into a Prompt file as a relation identity:

- absolute paths such as `/Users/...`
- a Project label (the user can rename it)
- a UUID
- an app-internal composite key such as `projectPath + promptName`

When the All Projects view resolves a relation, the source Prompt's
`projectPath` decides which Project the relation belongs to.

## UX principles

Keep the existing three-pane layout and the `Preview | Edit | History` main
structure. Do not add a large number of permanent tabs.

Prompt-specific information is surfaced as sections inside the existing
Preview / Inspector:

```text
Prompt body

Variables
Related
Usage Notes
Needs Attention
```

Compare uses a temporary view / sheet; it does not take a permanent main tab.

## Non-goals

This contract phase does not implement:

- Variable Contracts UI
- Related / Backlinks
- Prompt Health
- Compare
- Variant workflow
- Notes editing
- Examples / Assets
- Reusable Blocks
- Prompt execution
- API calls
- Chaining
- Eval / scoring
- Cloud sync / collaboration

Derived state (Health, Backlinks, and so on) is computed from the source of
truth and must never be written back as the source of truth.

Examples / Assets storage still needs its own design spike and must not smuggle
a sidecar format into this phase. Reusable Blocks are not part of the current
roadmap; if reconsidered later, they require a separate discussion of variable
grammar, copy / render semantics, cycle resolution, and whether Promptarium
stays a Knowledge Manager rather than a Composer / Compiler.

## Source of truth

Prompt-specific user data follows the same filesystem-truth rule as the rest
of the library: the real `.md` file in the user's Project is the single source
of truth. `~/.promptarium` and any derived index are disposable. See
prompts-design.md for the engineering contract and prompts-ux.md for the
interaction contract.
