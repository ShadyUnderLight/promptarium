import type { PromptSummary } from '$lib/prompts/types';
import { fingerprintsMatch, summaryFingerprint, type EntryFingerprint } from './search-index';

export type ExternalChangeState = null | 'disk_changed' | 'file_missing';

export interface SelectedRefreshInput {
  selectedProjectPath: string | null;
  selectedName: string | null;
  summaries: PromptSummary[];
  editorDirty: boolean;
  openedFingerprint: EntryFingerprint | null;
  reloadSelected: boolean;
}

export interface SelectedRefreshDecision {
  reloadSelected: boolean;
  clearSelection: boolean;
  externalChange: ExternalChangeState;
  preserveEditor: boolean;
}

/** Pure planner for how a refresh should treat the currently selected prompt. */
export function decideSelectedRefresh(input: SelectedRefreshInput): SelectedRefreshDecision {
  const { selectedProjectPath, selectedName, summaries, editorDirty, openedFingerprint, reloadSelected } = input;
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

  const diskChanged =
    openedFingerprint !== null &&
    !fingerprintsMatch(openedFingerprint, summaryFingerprint(summary));

  if (!reloadSelected) {
    return {
      reloadSelected: false,
      clearSelection: false,
      externalChange: editorDirty && diskChanged ? 'disk_changed' : null,
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
