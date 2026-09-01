import type { PromptSummary } from '$lib/prompts/types';
import type { SmartView } from './navigation-state';

export interface LibraryFilterState {
  smartView: SmartView;
  folderFilter: string;
  tagFilter: string;
  modelFilter: string;
  allProjects: boolean;
}

/**
 * AND-combination of the smart view, folder, tag and model filters that
 * `visiblePrompts()` applies to search results. Extracted as a pure function so
 * the combination semantics (e.g. Needs Attention + tag/folder) are unit
 * testable without the Svelte runtime. Every dimension must hold: the smart
 * view selects within whatever folder/tag/model filters are active.
 */
export function matchesLibraryFilters(
  prompt: PromptSummary,
  state: LibraryFilterState,
  issueCount: number
): boolean {
  const viewMatches =
    state.smartView === 'all' ||
    (state.smartView === 'favorites' && prompt.metadata.favorite) ||
    (state.smartView === 'needs-attention' && issueCount > 0) ||
    (state.smartView === prompt.metadata.status);
  const folderMatches =
    state.allProjects ||
    !state.folderFilter ||
    prompt.folder === state.folderFilter ||
    prompt.folder.startsWith(state.folderFilter + '/');
  const tagMatches = !state.tagFilter || prompt.metadata.tags.includes(state.tagFilter);
  const modelMatches = !state.modelFilter || prompt.metadata.models.includes(state.modelFilter);
  return viewMatches && folderMatches && tagMatches && modelMatches;
}
