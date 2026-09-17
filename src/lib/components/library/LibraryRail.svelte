<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n/i18n.svelte';

  type ShelfSection = 'projects' | 'folders' | 'tags';

  interface Props {
    shelfExpanded: boolean;
    allProjectsActive: boolean;
    foldersAvailable: boolean;
    tagsAvailable: boolean;
    historyAvailable: boolean;
    onAllProjects: () => void | Promise<void>;
    onFocusSearch: () => void;
    onFocusSection: (section: ShelfSection) => void | Promise<void>;
    onHistory: () => void;
    onToggleShelf: () => void;
  }

  let {
    shelfExpanded,
    allProjectsActive,
    foldersAvailable,
    tagsAvailable,
    historyAvailable,
    onAllProjects,
    onFocusSearch,
    onFocusSection,
    onHistory,
    onToggleShelf,
  }: Props = $props();
  let shelfToggle: HTMLButtonElement | undefined = $state(undefined);

  export function focusShelfToggle(): void {
    shelfToggle?.focus();
  }

  function handleToggleShelf(): void {
    onToggleShelf();
    shelfToggle?.focus();
  }
</script>

<nav class="library-rail" aria-label={t('sidebar.rail.aria')}>
  <button
    type="button"
    class="rail-button"
    class:rail-button--active={allProjectsActive}
    aria-current={allProjectsActive ? 'page' : undefined}
    aria-label={t('sidebar.rail.library')}
    title={t('sidebar.rail.library')}
    onclick={() => void onAllProjects()}
  >
    <Icon name="command" />
  </button>

  <button
    type="button"
    class="rail-button"
    aria-label={t('sidebar.rail.search')}
    title={t('sidebar.rail.search')}
    onclick={onFocusSearch}
  >
    <Icon name="search" />
  </button>

  <div class="library-rail__rule" aria-hidden="true"></div>

  <button
    type="button"
    class="rail-button"
    aria-label={t('sidebar.rail.projects')}
    title={t('sidebar.rail.projects')}
    aria-controls="project-shelf-projects"
    onclick={() => void onFocusSection('projects')}
  >
    <Icon name="list" />
  </button>

  <button
    type="button"
    class="rail-button"
    disabled={!foldersAvailable}
    aria-label={t('sidebar.rail.folders')}
    title={t('sidebar.rail.folders')}
    aria-controls={foldersAvailable ? 'project-shelf-folders' : undefined}
    onclick={() => void onFocusSection('folders')}
  >
    <Icon name="folder" />
  </button>

  <button
    type="button"
    class="rail-button"
    disabled={!tagsAvailable}
    aria-label={t('sidebar.rail.tags')}
    title={t('sidebar.rail.tags')}
    aria-controls={tagsAvailable ? 'project-shelf-tags' : undefined}
    onclick={() => void onFocusSection('tags')}
  >
    <Icon name="tag" />
  </button>

  <button
    type="button"
    class="rail-button"
    disabled={!historyAvailable}
    aria-label={t('sidebar.rail.history')}
    title={t('sidebar.rail.history')}
    onclick={onHistory}
  >
    <Icon name="history" />
  </button>

  <div class="library-rail__spacer" aria-hidden="true"></div>

  <button
    type="button"
    class="rail-button"
    class:rail-button--active={shelfExpanded}
    bind:this={shelfToggle}
    aria-expanded={shelfExpanded}
    aria-controls="project-shelf"
    aria-label={shelfExpanded ? t('sidebar.rail.collapseShelf') : t('sidebar.rail.expandShelf')}
    title={shelfExpanded ? t('sidebar.rail.collapseShelf') : t('sidebar.rail.expandShelf')}
    onclick={handleToggleShelf}
  >
    <Icon name="panel-left" />
  </button>
</nav>
