# Promptarium

Promptarium is a local-first Prompt Library for macOS: a project-based
Markdown vault for browsing, editing, tagging, favoriting and organizing large
prompt collections. It manages and organizes prompts — it is not a prompt
execution, chat, playground or deployment platform.

## What it is

- A project is a real folder on disk.
- A prompt is a normal .md file identified by its relative path.
- Existing plain Markdown files work unchanged.
- Optional YAML frontmatter adds description, tags, status, favorite, model
  hints and creation date.
- The filesystem remains the source of truth; there is no required database,
  cloud account, AI API key or Accessibility permission.
- The app can search prompt names, paths, metadata and bodies, preview Markdown,
  edit files atomically, and copy a prompt body without its frontmatter.

The application state and disposable indexes live under ~/.promptarium,
never inside a user project. Forgetting a project only forgets its registration;
it never deletes the folder. See
project_docs/library-redesign.md for migration notes and
project_docs/prompts-design.md for the engineering contract.

## Development

    pnpm install
    pnpm dev       # browser preview with an in-memory sample library
    pnpm tauri dev # native desktop app

## Verify

    pnpm check
    pnpm test:smoke
    pnpm build
    cd src-tauri && cargo test --lib

See CONTRIBUTING.md for the stack and source layout.

## License

MIT
