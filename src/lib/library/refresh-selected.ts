import type { PromptSummary } from '$lib/prompts/types';

export type ExternalChangeState = null | 'file_missing';

export interface SelectedRefreshInput {
  selectedProjectPath: string | null;
  selectedName: string | null;
  summaries: PromptSummary[];
  editorDirty: boolean;
  reloadSelected: boolean;
}

export interface SelectedRefreshDecision {
  reloadSelected: boolean;
  clearSelection: boolean;
  externalChange: ExternalChangeState;
  preserveEditor: boolean;
}

/** Pure planner for how a refresh should treat the currently selected prompt.
 *  Refresh never replaces a dirty editor buffer; only a deleted/renamed file
 *  surfaces as an external change while dirty. Disk-content conflicts are
 *  detected at save time by the Rust `expectedRaw` full-text compare, so no
 *  mtime/size prediction happens here. */
export function decideSelectedRefresh(input: SelectedRefreshInput): SelectedRefreshDecision {
  const { selectedProjectPath, selectedName, summaries, editorDirty, reloadSelected } = input;
  if (!selectedName || !selectedProjectPath) {
    return {
      reloadSelected: false,
      clearSelection: false,
      externalChange: null,
      preserveEditor: false,
    };
  }

  const summary = summaries.find(
    (prompt) => prompt.projectPath === selectedProjectPath && prompt.name === selectedName
  );
  if (!summary) {
    if (editorDirty) {
      return {
        reloadSelected: false,
        clearSelection: false,
        externalChange: 'file_missing',
        preserveEditor: true,
      };
    }
    return {
      reloadSelected: false,
      clearSelection: true,
      externalChange: null,
      preserveEditor: false,
    };
  }

  if (!reloadSelected) {
    return {
      reloadSelected: false,
      clearSelection: false,
      externalChange: null,
      preserveEditor: editorDirty,
    };
  }

  return {
    reloadSelected: true,
    clearSelection: false,
    externalChange: null,
    preserveEditor: false,
  };
}
