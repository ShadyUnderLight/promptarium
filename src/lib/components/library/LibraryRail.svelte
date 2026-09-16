<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { t } from '$lib/i18n/i18n.svelte';

  type ShelfSection = 'projects' | 'folders' | 'tags';

  interface Props {
    shelfExpanded: boolean;
    allProjectsActive: boolean;
    historyAvailable: boolean;
    onAllProjects: () => void | Promise<void>;
    onFocusSearch: () => void;
    onFocusSection: (section: ShelfSection) => void;
    onHistory: () => void;
    onToggleShelf: () => void;
  }

  let {
    shelfExpanded,
    allProjectsActive,
    historyAvailable,
    onAllProjects,
    onFocusSearch,
    onFocusSection,
    onHistory,
    onToggleShelf,
  }: Props = $props();
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
    onclick={() => onFocusSection('projects')}
  >
    <Icon name="list" />
  </button>

  <button
    type="button"
    class="rail-button"
    aria-label={t('sidebar.rail.folders')}
    title={t('sidebar.rail.folders')}
    aria-controls="project-shelf-folders"
    onclick={() => onFocusSection('folders')}
  >
    <Icon name="folder" />
  </button>

  <button
    type="button"
    class="rail-button"
    aria-label={t('sidebar.rail.tags')}
    title={t('sidebar.rail.tags')}
    aria-controls="project-shelf-tags"
    onclick={() => onFocusSection('tags')}
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
    aria-expanded={shelfExpanded}
    aria-controls="project-shelf"
    aria-label={shelfExpanded ? t('sidebar.rail.collapseShelf') : t('sidebar.rail.expandShelf')}
    title={shelfExpanded ? t('sidebar.rail.collapseShelf') : t('sidebar.rail.expandShelf')}
    onclick={onToggleShelf}
  >
    <Icon name="panel-left" />
  </button>
</nav>
