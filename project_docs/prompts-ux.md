# Prompt Library — Interaction Contract

Prompt Library is a calm, information-dense macOS desktop library for browsing,
understanding, editing and organizing Markdown prompts. The main surface is a
three-pane workspace: navigation on the left, the prompt library in the middle,
and the selected prompt inspector on the right.

## The surface at rest

The header contains the app name, a search field, New Prompt, Refresh and theme.
The workspace has resizable panes:

```text
Projects / views / folders / tags | Prompt list | Prompt detail
```

The left sidebar shows all registered projects vertically, then Smart Views
(All, Favorites, Draft, Archived), the active project's real folder tree, and
derived tag counts. The middle pane lists every matching prompt at rest; the
selected row remains visible while its detail loads. The right pane keeps a
persistent Preview/Edit inspector.

The UI is optimized for scanning hundreds of prompts: small rows, useful
description and tags, status, variable count when known, and modified time.
There are no launcher, chat, playground, cloud or accessibility-permission
workflows.

## Projects

Add Project opens a visible path field plus Browse. Browse fills the field; it
does not commit it, so a hidden folder can be reached by editing a visible
parent path. Adding registers the real folder and makes it active. The folder's
basename is the initial label.

Right-clicking a project offers rename label, fixed color swatches, Reveal in
Finder and Forget Project. Forget always says that files stay and never deletes
the project folder. A missing registered folder is shown as Project folder not
found, with Locate Folder and Forget actions; Locate replaces that registration's
path instead of adding a duplicate, and it is never rendered as 0 prompts.

## Navigation and filters

Selecting a project reloads its library. Selecting a Smart View, folder or tag
combines with the current search and other filters. Folder selection includes
descendants by default. Tags and counts are derived from frontmatter; there is
no separate tag registry.

The library toolbar supports name A–Z, name Z–A, modified newest/oldest and
favorites first, plus list and compact grid modes. Search covers filename,
relative path, description, tags and body. Search and filters are independent,
so Work + Coding + #review + active + regression is a normal state.

## Prompt detail

Single-click selects a prompt and opens its detail; it does not enter edit mode.
The header shows the display stem, relative path, favorite, status, tags,
Copy Prompt, Reveal in Finder and an actions menu. Preview renders Markdown
headings, paragraphs, lists, blockquotes, fenced code, inline code, tables,
links and rules. Prompt variables remain visually identifiable and are listed
by the existing variable parser.

Edit mode exposes the Markdown body and controls for description, tags, status,
favorite, model hints and created date. Cmd+S/Ctrl+S is explicit Save. A dirty
indicator is always visible. Navigating away from dirty changes asks before
discarding. Refresh offers explicit Reload from disk or Keep editing. Save writes the Markdown file atomically; it never creates a
database record or an in-project sidecar.

Invalid frontmatter keeps the prompt in the library with a warning badge. The
detail view can show raw content and never silently repairs it. If the file
changes externally while editing, the UI shows a conflict and offers Reload or
Keep editing rather than overwriting the external edit.

## Prompt-specific sections

Prompt-specific information — variables, related prompts, usage notes, health —
is surfaced as sections inside the existing Preview/Inspector, never as new
permanent main tabs:

```text
Prompt body

Variables
Related
Usage Notes
Needs Attention
```

The three-pane workspace and the Preview | Edit | History structure stay the
main information architecture. Compare uses a temporary view/sheet and does not
take a permanent main tab. Derived state such as health is a read-only section;
it is never written back as the source of truth. The section contract lives in
prompt-specific-capabilities.md.

## Prompt operations

New Prompt chooses the active project and optional folder, validates the
relative filename, and creates a .md. Duplicate writes a new physical file.
Rename and Move change the physical relative path and update the tree. Delete
requires a confirmation containing the prompt name, relative path and the fact
that the Markdown file will be deleted. Reveal opens the containing file in
Finder. Copy Prompt copies only the body, never YAML frontmatter.

## Batch management

Rows support multi-select. The batch toolbar can add/remove tags, set status,
favorite/unfavorite and delete with explicit confirmation. Each file write is
independent; a partial failure reports the exact paths that failed.

## Keyboard and native behavior

Cmd+N opens New Prompt, Cmd+S saves the dirty editor, Cmd+F focuses search,
Escape closes the innermost dialog/menu, and Enter accepts modal forms. Delete
does not hijack typing. Native light/dark mode and remembered pane widths are
supported. The app never injects text into another application and never needs
Accessibility permission.

The product must be understandable after two weeks away without reading this
document. A new control needs a visible label or an obvious contextual action.
