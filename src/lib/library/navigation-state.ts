export type SmartView = 'all' | 'favorites' | 'draft' | 'archived' | 'needs-attention';

export interface NavigationState {
  smartView: SmartView;
  folderFilter: string;
  tagFilter: string;
}

export type NavigationAction =
  | { kind: 'select-view'; view: SmartView }
  | { kind: 'select-folder'; folder: string }
  | { kind: 'select-tag'; tag: string };

/**
 * Sidebar navigation state transitions (Issue #13).
 *
 * Only Needs Attention composes with folder/tag filters — that is the new
 * capability the issue asks for. Every other smart view (Favorites, Draft,
 * Archived) keeps the original mutually-exclusive behavior: selecting one
 * clears the folder/tag filters, and picking a Folder or Tag falls back to the
 * 'all' view while clearing the other filter. Extracted as a pure function so
 * the sidebar interaction rules are unit-testable without the Svelte runtime.
 */
export function applyNavigationAction(state: NavigationState, action: NavigationAction): NavigationState {
  if (action.kind === 'select-view') {
    const next: NavigationState = {
      smartView: action.view,
      folderFilter: state.folderFilter,
      tagFilter: state.tagFilter,
    };
    if (action.view !== 'needs-attention') {
      next.folderFilter = '';
      next.tagFilter = '';
    }
    return next;
  }

  if (action.kind === 'select-folder') {
    return {
      smartView: state.smartView === 'needs-attention' ? 'needs-attention' : 'all',
      folderFilter: action.folder,
      tagFilter: '',
    };
  }

  // select-tag
  return {
    smartView: state.smartView === 'needs-attention' ? 'needs-attention' : 'all',
    folderFilter: '',
    tagFilter: action.tag,
  };
}
