<script lang="ts">
  import { isTauri } from '$lib/api';
  import {
    activeProject,
    addProject,
    buildFolderTree,
    createFolder,
    deleteFolder,
    forgetProject,
    isAllProjects,
    library,
    projectDisplayName,
    promptHealth,
    renameFolder,
    replaceProjectPath,
    setActiveProject,
    setAllProjectsScope,
    tagCounts,
  } from '$lib/library.svelte';
  import type { FolderNode, Project } from '$lib/prompts/types';
  import { applyNavigationAction, type NavigationAction } from '$lib/library/navigation-state';
  import { t } from '$lib/i18n/i18n.svelte';
  import { errorDetail } from '$lib/library/errors';
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
  const allProjectsActive = $derived(isAllProjects());
  const folders = $derived(flattenFolders(buildFolderTree(library.allPrompts, library.folderPaths)));
  const tags = $derived(tagCounts(library.allPrompts));
  const isMissing = $derived(
    !allProjectsActive && library.errorCode === 'PROJECT_FOLDER_NOT_FOUND'
  );
  const showNavigation = $derived(Boolean(project) || allProjectsActive);

  function flattenFolders(nodes: FolderNode[], depth = 0): Array<FolderNode & { depth: number }> {
    return nodes.flatMap((node) => [{ ...node, depth }, ...flattenFolders(node.children, depth + 1)]);
  }

  function viewCount(view: 'all' | 'favorites' | 'draft' | 'archived' | 'needs-attention'): number {
    if (view === 'all') return library.allPrompts.length;
    if (view === 'favorites') return library.allPrompts.filter((item) => item.metadata.favorite).length;
    if (view === 'needs-attention') return library.allPrompts.filter((item) => promptHealth(item).length > 0).length;
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
      onNotice(errorDetail(error));
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
      onNotice(errorDetail(error));
    }
  }

  async function enterAllProjects(): Promise<void> {
    if (!canNavigate()) return;
    if (!library.projects.length) {
      onNotice('Add a prompt project first.');
      return;
    }
    try {
      await setAllProjectsScope();
    } catch (error) {
      onNotice(errorDetail(error));
    }
  }

  function closeMenu(): void {
    menu = null;
  }

  /** Apply a sidebar navigation transition and commit the result to the library
   *  state. Only Needs Attention composes with folder/tag filters; the other
   *  smart views and the Folder/Tag navigation keep their original semantics
   *  (see applyNavigationAction). */
  function applyNav(action: NavigationAction): void {
    const next = applyNavigationAction(
      { smartView: library.smartView, folderFilter: library.folderFilter, tagFilter: library.tagFilter },
      action
    );
    library.smartView = next.smartView;
    library.folderFilter = next.folderFilter;
    library.tagFilter = next.tagFilter;
  }

  function selectView(view: typeof library.smartView): void {
    applyNav({ kind: 'select-view', view });
  }

  async function newFolder(): Promise<void> {
    if (!canNavigate()) return;
    const name = window.prompt('Folder path inside this project', library.folderFilter || '');
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim());
      library.folderFilter = name.trim().replace(/\/+$/, '');
    } catch (error) {
      onNotice(errorDetail(error));
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
        onNotice(errorDetail(error));
      }
    } else if (action === 'delete' && window.confirm('Delete empty folder “' + folder + '”?')) {
      if (!canNavigate()) return;
      try {
        await deleteFolder(folder);
        if (library.folderFilter === folder) library.folderFilter = '';
      } catch (error) {
        onNotice(errorDetail(error));
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
      onNotice(errorDetail(error));
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
      <button
        type="button"
        class="project-row project-row--all"
        class:project-row--active={allProjectsActive}
        onclick={enterAllProjects}
        title="Search prompts across every registered project"
      >
        <span class="project-row__dot project-row__dot--all"></span>
        <span class="project-row__name">All Projects</span>
        {#if allProjectsActive}<span class="project-row__count">{library.allPrompts.length}</span>{/if}
      </button>
      {#each library.projects as item (item.path)}
        <button
          type="button"
          class="project-row"
          class:project-row--active={!allProjectsActive && library.activeProjectPath === item.path}
          onclick={() => switchProject(item.path)}
          oncontextmenu={(event) => openMenu(event, item)}
          title={item.path}
        >
          <span class="project-row__dot" style={'--project-color:' + (item.color ?? 'var(--text-faint)')}></span>
          <span class="project-row__name">{item.name}</span>
          {#if !allProjectsActive && library.activeProjectPath === item.path}<span class="project-row__count">{library.allPrompts.length}</span>{/if}
        </button>
      {:else}
        <p class="sidebar-empty">Add a folder to start your library.</p>
      {/each}
    </div>
  </div>

  {#if allProjectsActive && library.allProjectsWarnings.length}
    <div class="missing-project missing-project--warning">
      <strong>{library.allProjectsWarnings.length} project{library.allProjectsWarnings.length === 1 ? '' : 's'} could not refresh</strong>
      {#each library.allProjectsWarnings as warning (warning.projectPath)}
        <span>{projectDisplayName(warning.projectPath)} — {warning.error}</span>
      {/each}
    </div>
  {/if}

  {#if isMissing}
    <div class="missing-project">
      <strong>{t('error.projectFolderNotFound')}</strong>
      <span>{library.activeProjectPath}</span>
      <div>
        <button
          type="button"
          class="btn btn--sm"
          onclick={() => { addPath = library.activeProjectPath; relocateFrom = library.activeProjectPath; }}
        >{t('project.missing.locate')}</button>
        <button type="button" class="btn btn--ghost btn--sm" onclick={forgetMissingProject}>{t('project.missing.forget')}</button>
      </div>
    </div>
  {/if}

  {#if showNavigation}
    <div class="sidebar-section">
      <div class="sidebar-section__heading"><span>Smart Views</span></div>
      <nav class="sidebar-nav">
        <button type="button" class:sidebar-nav__item--active={library.smartView === 'all' && !library.folderFilter && !library.tagFilter} class="sidebar-nav__item" onclick={() => selectView('all')}>
          <span>All prompts</span><span>{viewCount('all')}</span>
        </button>
        <button type="button" class:sidebar-nav__item--active={library.smartView === 'needs-attention'} class="sidebar-nav__item" onclick={() => selectView('needs-attention')}>
          <span>Needs Attention</span><span>{viewCount('needs-attention')}</span>
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

    {#if project && !allProjectsActive}
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
              onclick={() => applyNav({ kind: 'select-folder', folder: folder.path })}
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
    {/if}

    <div class="sidebar-section sidebar-section--tags">
      <div class="sidebar-section__heading"><span>Tags</span></div>
      <nav class="sidebar-nav">
        {#each tags as item (item.tag)}
          <button type="button" class:sidebar-nav__item--active={library.tagFilter === item.tag} class="sidebar-nav__item" onclick={() => applyNav({ kind: 'select-tag', tag: item.tag })}>
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
