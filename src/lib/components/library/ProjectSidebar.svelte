<script lang="ts">
  import { isTauri } from '$lib/api';
  import {
    activeProject,
    addProject,
    buildFolderTree,
    createFolder,
    deleteFolder,
    forgetProject,
    library,
    renameFolder,
    replaceProjectPath,
    setActiveProject,
    tagCounts,
  } from '$lib/library.svelte';
  import type { FolderNode, Project } from '$lib/prompts/types';
  import ProjectMenu from './ProjectMenu.svelte';

  interface Props {
    onNewPrompt: () => void;
    canNavigate: () => boolean;
    onNotice: (message: string) => void;
  }

  let { onNewPrompt, canNavigate, onNotice }: Props = $props();
  let addPath = $state<string | null>(null);
  let relocateFrom = $state<string | null>(null);
  let pathInput: HTMLInputElement | undefined = $state(undefined);
  let busy = $state(false);
  let menu = $state<{ project: Project; x: number; y: number } | null>(null);

  const project = $derived(activeProject());
  const folders = $derived(flattenFolders(buildFolderTree(library.allPrompts, library.folderPaths)));
  const tags = $derived(tagCounts(library.allPrompts));
  const isMissing = $derived(Boolean(library.error?.toLowerCase().includes('project folder not found')));

  function flattenFolders(nodes: FolderNode[], depth = 0): Array<FolderNode & { depth: number }> {
    return nodes.flatMap((node) => [{ ...node, depth }, ...flattenFolders(node.children, depth + 1)]);
  }

  function viewCount(view: 'all' | 'favorites' | 'draft' | 'archived'): number {
    if (view === 'all') return library.allPrompts.length;
    if (view === 'favorites') return library.allPrompts.filter((item) => item.metadata.favorite).length;
    return library.allPrompts.filter((item) => item.metadata.status === view).length;
  }

  function basename(path: string): string {
    const pieces = path.split(/[\\/]/).filter(Boolean);
    return pieces[pieces.length - 1] ?? path;
  }

  async function pickFolder(): Promise<string | null> {
    if (!isTauri()) return window.prompt('Folder path (browser-dev only):', '/dev/mock/prompts');
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: 'Choose a prompt project folder' });
    return typeof picked === 'string' ? picked : null;
  }

  async function browse(): Promise<void> {
    const picked = await pickFolder();
    if (picked !== null) {
      addPath = picked;
      queueMicrotask(() => pathInput?.focus());
    }
  }

  async function submitProject(): Promise<void> {
    const path = addPath?.trim();
    if (!path) return;
    if (!canNavigate()) return;
    const oldPath = relocateFrom;
    busy = true;
    try {
      if (oldPath) {
        await replaceProjectPath(oldPath, path);
        onNotice('Project folder located.');
      } else {
        await addProject(basename(path), path);
        onNotice('Project added.');
      }
      addPath = null;
      relocateFrom = null;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
    }
  }

  function onPathKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitProject();
    } else if (event.key === 'Escape') {
      addPath = null;
      relocateFrom = null;
    }
  }

  function closeAddProject(): void {
    addPath = null;
    relocateFrom = null;
  }

  function openMenu(event: MouseEvent, item: Project): void {
    event.preventDefault();
    menu = {
      project: item,
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 310),
    };
  }

  async function switchProject(path: string): Promise<void> {
    if (!canNavigate()) return;
    try {
      await setActiveProject(path);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function closeMenu(): void {
    menu = null;
  }

  function selectView(view: typeof library.smartView): void {
    library.smartView = view;
    library.folderFilter = '';
    library.tagFilter = '';
  }

  async function newFolder(): Promise<void> {
    if (!canNavigate()) return;
    const name = window.prompt('Folder path inside this project', library.folderFilter || '');
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim());
      library.folderFilter = name.trim().replace(/\/+$/, '');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function folderMenu(event: MouseEvent, folder: string): Promise<void> {
    event.preventDefault();
    const action = window.prompt('Folder action: rename or delete', 'rename');
    if (action === 'rename') {
      const next = window.prompt('New folder path', folder);
      if (!next?.trim()) return;
      if (!canNavigate()) return;
      try {
        await renameFolder(folder, next.trim());
        if (library.folderFilter === folder || library.folderFilter.startsWith(folder + '/')) {
          library.folderFilter = next.trim() + library.folderFilter.slice(folder.length);
        }
      } catch (error) {
        onNotice(error instanceof Error ? error.message : String(error));
      }
    } else if (action === 'delete' && window.confirm('Delete empty folder “' + folder + '”?')) {
      if (!canNavigate()) return;
      try {
        await deleteFolder(folder);
        if (library.folderFilter === folder) library.folderFilter = '';
      } catch (error) {
        onNotice(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function forgetMissingProject(): Promise<void> {
    if (!library.activeProjectPath) return;
    if (!window.confirm('Forget this missing project? No files will be deleted.')) return;
    if (!canNavigate()) return;
    try {
      await forgetProject(library.activeProjectPath);
      onNotice('Project forgotten. Its files were not changed.');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    }
  }
</script>

<aside class="project-sidebar" aria-label="Prompt Library navigation">
  <div class="sidebar-section sidebar-section--projects">
    <div class="sidebar-section__heading">
      <span>Projects</span>
      <button type="button" class="sidebar-icon" aria-label="Add project" title="Add project" onclick={() => { addPath = ''; relocateFrom = null; }}>＋</button>
    </div>

    {#if addPath !== null}
      <div class="add-project-row">
        <input bind:this={pathInput} bind:value={addPath} placeholder="Paste a folder path…" spellcheck="false" onkeydown={onPathKeydown} />
        <div class="add-project-row__actions">
          <button type="button" class="btn btn--ghost btn--sm" onclick={browse} disabled={busy}>Browse</button>
          <button type="button" class="btn btn--primary btn--sm" onclick={submitProject} disabled={busy || !addPath.trim()}>{relocateFrom ? 'Locate' : 'Add'}</button>
          <button type="button" class="btn btn--ghost btn--sm" onclick={closeAddProject} disabled={busy}>×</button>
        </div>
      </div>
    {/if}

    <div class="project-list">
      {#each library.projects as item (item.path)}
        <button
          type="button"
          class="project-row"
          class:project-row--active={library.activeProjectPath === item.path}
          onclick={() => switchProject(item.path)}
          oncontextmenu={(event) => openMenu(event, item)}
          title={item.path}
        >
          <span class="project-row__dot" style={'--project-color:' + (item.color ?? 'var(--text-faint)')}></span>
          <span class="project-row__name">{item.name}</span>
          {#if library.activeProjectPath === item.path}<span class="project-row__count">{library.allPrompts.length}</span>{/if}
        </button>
      {:else}
        <p class="sidebar-empty">Add a folder to start your library.</p>
      {/each}
    </div>
  </div>

  {#if isMissing}
    <div class="missing-project">
      <strong>Project folder not found</strong>
      <span>{library.activeProjectPath}</span>
      <div>
        <button
          type="button"
          class="btn btn--sm"
          onclick={() => { addPath = library.activeProjectPath; relocateFrom = library.activeProjectPath; }}
        >Locate folder</button>
        <button type="button" class="btn btn--ghost btn--sm" onclick={forgetMissingProject}>Forget</button>
      </div>
    </div>
  {/if}

  {#if project}
    <div class="sidebar-section">
      <div class="sidebar-section__heading"><span>Smart Views</span></div>
      <nav class="sidebar-nav">
        <button type="button" class:sidebar-nav__item--active={library.smartView === 'all' && !library.folderFilter && !library.tagFilter} class="sidebar-nav__item" onclick={() => selectView('all')}>
          <span>All prompts</span><span>{viewCount('all')}</span>
        </button>
        <button type="button" class:sidebar-nav__item--active={library.smartView === 'favorites'} class="sidebar-nav__item" onclick={() => selectView('favorites')}>
          <span>Favorites</span><span>{viewCount('favorites')}</span>
        </button>
        <button type="button" class:sidebar-nav__item--active={library.smartView === 'draft'} class="sidebar-nav__item" onclick={() => selectView('draft')}>
          <span>Draft</span><span>{viewCount('draft')}</span>
        </button>
        <button type="button" class:sidebar-nav__item--active={library.smartView === 'archived'} class="sidebar-nav__item" onclick={() => selectView('archived')}>
          <span>Archived</span><span>{viewCount('archived')}</span>
        </button>
      </nav>
    </div>

    <div class="sidebar-section sidebar-section--folders">
      <div class="sidebar-section__heading">
        <span>Folders</span>
        <button type="button" class="sidebar-icon" aria-label="New folder" title="New folder" onclick={newFolder}>＋</button>
      </div>
      <nav class="sidebar-nav">
        {#each folders as folder (folder.path)}
          <button
            type="button"
            class:sidebar-nav__item--active={library.folderFilter === folder.path}
            class="sidebar-nav__item"
            style={'--depth:' + folder.depth}
            onclick={() => { library.folderFilter = folder.path; library.smartView = 'all'; library.tagFilter = ''; }}
            oncontextmenu={(event) => folderMenu(event, folder.path)}
            title="Right-click to rename or delete an empty folder"
          >
            <span class="folder-glyph">⌄</span><span>{folder.name}</span><span>{folder.promptCount}</span>
          </button>
        {:else}
          <p class="sidebar-empty">Folders appear from your project tree.</p>
        {/each}
      </nav>
    </div>

    <div class="sidebar-section sidebar-section--tags">
      <div class="sidebar-section__heading"><span>Tags</span></div>
      <nav class="sidebar-nav">
        {#each tags as item (item.tag)}
          <button type="button" class:sidebar-nav__item--active={library.tagFilter === item.tag} class="sidebar-nav__item" onclick={() => { library.tagFilter = item.tag; library.smartView = 'all'; library.folderFilter = ''; }}>
            <span class="tag-label">#{item.tag}</span><span>{item.count}</span>
          </button>
        {:else}
          <p class="sidebar-empty">Tags come from prompt frontmatter.</p>
        {/each}
      </nav>
    </div>

    <button type="button" class="sidebar-new-prompt" onclick={onNewPrompt}>＋ New prompt</button>
  {/if}
</aside>

{#if menu}
  <ProjectMenu project={menu.project} x={menu.x} y={menu.y} onClose={closeMenu} {onNotice} {canNavigate} />
{/if}
