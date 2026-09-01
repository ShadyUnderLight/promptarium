import {
  addProject as apiAddProject,
  createFolder as apiCreateFolder,
  createPrompt as apiCreatePrompt,
  deleteEmptyFolder as apiDeleteEmptyFolder,
  deletePrompt as apiDeletePrompt,
  gitFileDiff as apiGitFileDiff,
  gitFileHistory as apiGitFileHistory,
  gitRepositoryInfo as apiGitRepositoryInfo,
  listProjects as apiListProjects,
  listFolders as apiListFolders,
  movePrompt as apiMovePrompt,
  readPrompt as apiReadPrompt,
  renameFolder as apiRenameFolder,
  renamePrompt as apiRenamePrompt,
  removeProject as apiRemoveProject,
  renameProjectLabel as apiRenameProjectLabel,
  replaceProjectPath as apiReplaceProjectPath,
  revealInFinder as apiRevealInFinder,
  savePrompt as apiSavePrompt,
  scanProject as apiScanProject,
  searchPrompts as apiSearchPrompts,
  setActiveProject as apiSetActiveProject,
  setProjectColor as apiSetProjectColor,
  syncProjectWatcher as apiSyncProjectWatcher,
  listenProjectFsChanged,
  listenProjectFsWatchError,
  type ProjectWatcherStatus,
} from './api';
import { toasts } from './prompts/toasts.svelte';
import type {
  FolderNode,
  Project,
  PromptDocument,
  PromptMetadata,
  PromptSort,
  PromptSummary,
  PromptViewMode,
} from './prompts/types';
import type { GitFileCommit, GitFileDiff, GitFileHistoryPage, GitRepositoryInfo } from './prompts/git-types';
import {
  appendHistoryPage,
  isStaleHistoryDiffResponse,
  isStaleHistoryResponse,
} from './prompts/history';
import { parseVariables } from './variables/variables';
import { defaultPromptMetadata } from './prompts/types';
import {
  buildSearchIndexFromPlan,
  buildUntilRevisionStable,
  fingerprintsMatch,
  planIndexRefresh,
  searchEntryFromDocument,
  summaryFingerprint,
  type SearchEntry,
} from './library/search-index';
import { openedFingerprintForDocument, summaryFromDocument } from './library/selected-document';
import { FsRefreshScheduler } from './library/fs-refresh-scheduler';
import {
  decideSelectedRefresh,
  type ExternalChangeState,
} from './library/refresh-selected';
import {
  ALL_PROJECTS_CONCURRENCY,
  aggregateScanResults,
  finalizeAllProjectsScanResults,
  mapWithConcurrency,
  mergeSearchResults,
  refreshAllProjectsProjectScan,
  searchProjectIndex,
  summariesContainIdentity,
  type ProjectScanResult,
} from './library/all-projects';
import {
  isAllProjectsScope,
  promptKey,
  type LibraryScope,
} from './library/scope';
import {
  allProjectsRefreshFlagsAtStart,
  finalizeAllProjectsRefreshFlags,
  projectScopeRefreshFlags,
  resolveLibraryScope,
} from './library/scope-refresh';

const SEARCH_DEBOUNCE_MS = 100;

export const library = $state({
  projects: [] as Project[],
  activeProjectPath: null as string | null,
  libraryScope: { kind: 'all-projects' } as LibraryScope,
  allPrompts: [] as PromptSummary[],
  prompts: [] as PromptSummary[],
  selectedProjectPath: null as string | null,
  selectedName: null as string | null,
  selected: null as PromptDocument | null,
  allProjectsWarnings: [] as Array<{ projectPath: string; error: string }>,
  allProjectsHealthyPaths: [] as string[],
  loading: false,
  refreshing: false,
  loadingDocument: false,
  error: null as string | null,
  searchQuery: '',
  smartView: 'all' as 'all' | 'favorites' | 'draft' | 'archived',
  folderFilter: '',
  tagFilter: '',
  modelFilter: '',
  sort: 'modified-desc' as PromptSort,
  viewMode: 'list' as PromptViewMode,
  sidebarWidth: 244,
  libraryWidth: 362,
  folderPaths: [] as string[],
  searchIndexVersion: 0,
  historyLoading: false,
  historyRepo: null as GitRepositoryInfo | null,
  historyPage: null as GitFileHistoryPage | null,
  historySelectedCommit: null as string | null,
  historyDiff: null as GitFileDiff | null,
  historyDiffLoading: false,
  historyError: null as string | null,
  historyLoadingMore: false,
  externalChangeState: null as ExternalChangeState,
  fsWatchAvailable: true,
  fsWatchMessage: null as string | null,
});

export interface RefreshLibraryOptions {
  editorDirty?: boolean;
  reloadSelected?: boolean;
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadSerial = 0;
let documentSerial = 0;
let searchSerial = 0;
let historySerial = 0;

const diffCache = new Map<string, GitFileDiff>();

const searchIndexes = new Map<string, Map<string, SearchEntry>>();
const searchIndexRevisions = new Map<string, number>();
const variableCounts = new Map<string, number>();
const fsRefreshScheduler = new FsRefreshScheduler(300);

let selectedOpenedFingerprint: ReturnType<typeof summaryFingerprint> | null = null;
let editorDirtyProvider: (() => boolean) | null = null;
let fsUnlisten: (() => void) | null = null;
let fsErrorUnlisten: (() => void) | null = null;
let lastFsWatchNotice = '';

function searchIndexRevision(projectPath: string): number {
  return searchIndexRevisions.get(projectPath) ?? 0;
}

function bumpSearchIndexRevision(projectPath: string): void {
  searchIndexRevisions.set(projectPath, searchIndexRevision(projectPath) + 1);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isAllProjects(): boolean {
  return isAllProjectsScope(library.libraryScope);
}

function scopeStillCurrent(serial: number, scope: LibraryScope): boolean {
  return serial === loadSerial && library.libraryScope.kind === scope.kind &&
    (scope.kind === 'all-projects' ||
      (library.libraryScope.kind === 'project' && library.libraryScope.projectPath === scope.projectPath));
}

function selectedIdentityMatches(project: string, name: string): boolean {
  return library.selectedProjectPath === project && library.selectedName === name;
}

function healthyProjectsForSearch(): Project[] {
  const paths = new Set(library.allProjectsHealthyPaths);
  return library.projects.filter((project) => paths.has(project.path));
}

async function refreshCurrentScope(options: RefreshLibraryOptions = {}): Promise<void> {
  if (isAllProjects()) await refreshAllProjects(options);
  else await refreshLibrary(options);
}

function cloneMetadata(metadata: PromptMetadata): PromptMetadata {
  return {
    ...metadata,
    tags: [...metadata.tags],
    models: [...metadata.models],
    extra: { ...metadata.extra },
  };
}

function summaryOf(document: PromptDocument): PromptSummary {
  return summaryFromDocument(document);
}

function setSelectedDocument(document: PromptDocument): void {
  library.selectedProjectPath = document.projectPath;
  library.selectedName = document.name;
  library.selected = document;
  selectedOpenedFingerprint = openedFingerprintForDocument(document);
  library.externalChangeState = null;
}

function clearSelectedDocument(): void {
  library.selectedProjectPath = null;
  library.selectedName = null;
  library.selected = null;
  selectedOpenedFingerprint = null;
  library.externalChangeState = null;
}

function diffCacheKey(projectPath: string, name: string, commit: string): string {
  return promptKey(projectPath, name) + '\u0000' + commit;
}

function resetHistoryState(): void {
  library.historyLoading = false;
  library.historyRepo = null;
  library.historyPage = null;
  library.historySelectedCommit = null;
  library.historyDiff = null;
  library.historyDiffLoading = false;
  library.historyError = null;
  library.historyLoadingMore = false;
}

function invalidateHistoryLoad(): void {
  historySerial++;
  resetHistoryState();
}

function syncVariableCounts(projectPath: string, index: Map<string, SearchEntry>): void {
  const prefix = projectPath + '\u0000';
  for (const key of variableCounts.keys()) {
    if (key.startsWith(prefix)) variableCounts.delete(key);
  }
  for (const entry of index.values()) {
    if (entry.variableCount !== undefined) {
      variableCounts.set(promptKey(projectPath, entry.summary.name), entry.variableCount);
    }
  }
}

function updateSearchEntry(document: PromptDocument): void {
  bumpSearchIndexRevision(document.projectPath);
  const index = searchIndexes.get(document.projectPath);
  if (!index) return;
  const entry = searchEntryFromDocument(document);
  index.set(document.name, entry);
  variableCounts.set(promptKey(document.projectPath, document.name), entry.variableCount ?? 0);
  library.searchIndexVersion++;
}

async function refreshSearchIndex(
  projectPath: string,
  summaries: PromptSummary[],
  serial: number
): Promise<{ retried: boolean }> {
  const result = await buildUntilRevisionStable({
    getRevision: () => searchIndexRevision(projectPath),
    shouldAbort: () =>
      serial !== loadSerial ||
      (library.libraryScope.kind === 'project' && projectPath !== library.activeProjectPath),
    build: async () => {
      const oldIndex = searchIndexes.get(projectPath);
      const plan = planIndexRefresh(oldIndex, summaries);
      const built = await buildSearchIndexFromPlan(plan, {
        projectPath,
        readBody: async (prompt) => searchEntryFromDocument(await apiReadPrompt(projectPath, prompt.name)),
        selectedEntry: (prompt) => {
          const selected = library.selected;
          if (
            selected &&
            selected.projectPath === projectPath &&
            selected.name === prompt.name &&
            fingerprintsMatch(summaryFingerprint(summaryOf(selected)), summaryFingerprint(prompt))
          ) {
            return searchEntryFromDocument(selected);
          }
          return null;
        },
      });
      return { plan, ...built };
    },
    commit: ({ index, stats, plan }) => {
      searchIndexes.set(projectPath, index);
      syncVariableCounts(projectPath, index);
      library.searchIndexVersion++;
      if (import.meta.env.DEV) {
        console.debug(
          `[index] project=${projectPath} reused=${plan.reused.size} planned=${stats.planned} read=${stats.bodyReads} selectedReuse=${stats.selectedReuses} removed=${plan.removed.length}`
        );
      }
    },
  });

  if (!result) return { retried: false };

  if (library.searchQuery.trim() && !isAllProjects()) void runSearch();
  return { retried: result.retried };
}

function saveUiState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(
    'prompt-library-ui',
    JSON.stringify({
      sidebarWidth: library.sidebarWidth,
      libraryWidth: library.libraryWidth,
      sort: library.sort,
      viewMode: library.viewMode,
    })
  );
}

function loadUiState(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const saved = JSON.parse(localStorage.getItem('prompt-library-ui') ?? 'null') as Partial<typeof library> | null;
    if (!saved) return;
    if (typeof saved.sidebarWidth === 'number') library.sidebarWidth = clamp(saved.sidebarWidth, 200, 360);
    if (typeof saved.libraryWidth === 'number') library.libraryWidth = clamp(saved.libraryWidth, 280, 520);
    if (saved.sort) library.sort = saved.sort as PromptSort;
    if (saved.viewMode === 'list' || saved.viewMode === 'grid') library.viewMode = saved.viewMode;
  } catch {
    // Preferences are derived state. A malformed browser preference must not
    // prevent the Markdown library from opening.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function invalidateDocumentLoad(): void {
  documentSerial++;
  library.loadingDocument = false;
  invalidateHistoryLoad();
}

export function activeProject(): Project | null {
  return library.projects.find((project) => project.path === library.activeProjectPath) ?? null;
}

export async function initLibrary(): Promise<void> {
  loadUiState();
  await refreshProjects();
  await startFilesystemWatch();
}

export function setEditorDirtyProvider(provider: (() => boolean) | null): void {
  editorDirtyProvider = provider;
}

export function dismissExternalChange(): void {
  library.externalChangeState = null;
}

function applyWatcherStatus(status: ProjectWatcherStatus): void {
  library.fsWatchAvailable = status.available;
  library.fsWatchMessage = status.message ?? null;
  if (!status.available && status.message) {
    notifyFsWatchUnavailable(status.message);
  }
}

function notifyFsWatchUnavailable(message: string): void {
  if (message === lastFsWatchNotice) return;
  lastFsWatchNotice = message;
  toasts.push('Automatic filesystem refresh is unavailable. Focus or Refresh still works.');
}

export async function startFilesystemWatch(): Promise<void> {
  await stopFilesystemWatch();
  lastFsWatchNotice = '';
  applyWatcherStatus(await apiSyncProjectWatcher(library.activeProjectPath));
  fsUnlisten = await listenProjectFsChanged((event) => {
    if (event.projectPath !== library.activeProjectPath) return;
    fsRefreshScheduler.notify(async () => {
      await refreshLibrary({ editorDirty: editorDirtyProvider?.() ?? false });
    });
  });
  fsErrorUnlisten = await listenProjectFsWatchError((event) => {
    if (event.projectPath && event.projectPath !== library.activeProjectPath) return;
    library.fsWatchAvailable = false;
    library.fsWatchMessage = event.message;
    notifyFsWatchUnavailable(event.message);
  });
}

export async function stopFilesystemWatch(): Promise<void> {
  if (fsUnlisten) {
    fsUnlisten();
    fsUnlisten = null;
  }
  if (fsErrorUnlisten) {
    fsErrorUnlisten();
    fsErrorUnlisten = null;
  }
}

export interface RefreshProjectsOptions {
  preserveScope?: boolean;
}

export async function refreshProjects(options: RefreshProjectsOptions = {}): Promise<void> {
  const preserveScope = options.preserveScope ?? false;
  try {
    const previousScope = library.libraryScope;
    const result = await apiListProjects();
    if (result.active !== library.activeProjectPath) {
      invalidateDocumentLoad();
      library.selectedProjectPath = null;
      library.selectedName = null;
      library.selected = null;
    }
    library.projects = result.projects;
    library.activeProjectPath = result.active;
    library.libraryScope = resolveLibraryScope(previousScope, result.projects, result.active, {
      preserveScope,
    });
    library.error = null;
    if (isAllProjects()) await refreshAllProjects();
    else await refreshLibrary();
  } catch (error) {
    invalidateDocumentLoad();
    library.error = errorText(error);
    library.projects = [];
    library.activeProjectPath = null;
    library.libraryScope = { kind: 'all-projects' };
    library.allPrompts = [];
    library.prompts = [];
    library.folderPaths = [];
    library.selected = null;
    library.selectedProjectPath = null;
    library.selectedName = null;
  }
}

export async function refreshLibrary(options: RefreshLibraryOptions = {}): Promise<void> {
  const editorDirty = options.editorDirty ?? false;
  const reloadSelected = options.reloadSelected ?? !editorDirty;
  const project = library.activeProjectPath;
  const serial = ++loadSerial;
  if (!project) {
    invalidateDocumentLoad();
    library.allPrompts = [];
    library.prompts = [];
    library.folderPaths = [];
    library.selected = null;
    library.selectedProjectPath = null;
    library.selectedName = null;
    selectedOpenedFingerprint = null;
    library.externalChangeState = null;
    return;
  }
  if (library.libraryScope.kind === 'all-projects') {
    await refreshAllProjects(options);
    return;
  }
  const projectRefreshFlags = projectScopeRefreshFlags();
  library.refreshing = projectRefreshFlags.refreshing;
  library.loading = true;
  try {
    const [summaries, folders] = await Promise.all([apiScanProject(project), apiListFolders(project)]);
    if (serial !== loadSerial) return;
    library.allPrompts = summaries;
    library.folderPaths = folders;
    library.error = null;
    void refreshSearchIndex(project, summaries, serial);
    const query = library.searchQuery;
    const querySerial = searchSerial;
    if (library.searchQuery.trim()) {
      const indexed = searchIndexed(project, query);
      library.prompts = indexed ?? (await apiSearchPrompts(project, query));
    } else {
      library.prompts = summaries;
    }
    if (serial !== loadSerial || querySerial !== searchSerial || query !== library.searchQuery) return;

    const decision = decideSelectedRefresh({
      selectedProjectPath: library.selectedProjectPath,
      selectedName: library.selectedName,
      summaries,
      editorDirty,
      openedFingerprint: selectedOpenedFingerprint,
      reloadSelected,
    });

    if (decision.externalChange) {
      library.externalChangeState = decision.externalChange;
    } else if (decision.reloadSelected) {
      library.externalChangeState = null;
    }

    const selectedName = library.selectedName;
    const selectedProject = library.selectedProjectPath;
    const selectedDocumentSerial = documentSerial;
    if (decision.clearSelection) {
      clearSelectedDocument();
    } else if (
      decision.reloadSelected &&
      selectedName &&
      selectedProject === project &&
      summaries.some((prompt) => prompt.name === selectedName)
    ) {
      const selected = await apiReadPrompt(project, selectedName);
      if (
        serial !== loadSerial ||
        project !== library.activeProjectPath ||
        selectedDocumentSerial !== documentSerial ||
        library.selectedName !== selectedName ||
        library.selectedProjectPath !== selectedProject
      ) return;
      setSelectedDocument(selected);
    }
  } catch (error) {
    if (serial !== loadSerial || project !== library.activeProjectPath) return;
    library.error = errorText(error);
    library.allPrompts = [];
    library.prompts = [];
    if (library.error.toLowerCase().includes('not found')) {
      if (!editorDirty) {
        library.selected = null;
        library.selectedProjectPath = null;
        library.selectedName = null;
        selectedOpenedFingerprint = null;
      } else {
        library.externalChangeState = 'file_missing';
      }
    }
  } finally {
    if (serial === loadSerial) library.loading = false;
  }
}

export async function refreshAllProjects(options: RefreshLibraryOptions = {}): Promise<void> {
  const editorDirty = options.editorDirty ?? false;
  const reloadSelected = options.reloadSelected ?? !editorDirty;
  const scope: LibraryScope = { kind: 'all-projects' };
  const serial = ++loadSerial;
  if (library.projects.length === 0) {
    library.allPrompts = [];
    library.prompts = [];
    library.folderPaths = [];
    library.allProjectsWarnings = [];
    library.allProjectsHealthyPaths = [];
    library.loading = false;
    library.refreshing = false;
    return;
  }
  const startFlags = allProjectsRefreshFlagsAtStart(library.allPrompts.length);
  library.loading = startFlags.loading;
  library.refreshing = startFlags.refreshing;
  const warnings: Array<{ projectPath: string; error: string }> = [];
  try {
    const scanResults = await mapWithConcurrency(library.projects, ALL_PROJECTS_CONCURRENCY, async (project) => {
      try {
        return await refreshAllProjectsProjectScan(
          project.path,
          apiScanProject,
          (projectPath, summaries) => refreshSearchIndex(projectPath, summaries, serial),
          searchIndexRevision,
          () => !scopeStillCurrent(serial, scope)
        );
      } catch (error) {
        warnings.push({ projectPath: project.path, error: errorText(error) });
        return null;
      }
    });
    if (!scopeStillCurrent(serial, scope)) return;

    const healthy = scanResults.filter((result): result is ProjectScanResult => result !== null);
    const committed = await finalizeAllProjectsScanResults({
      results: healthy,
      getRevision: searchIndexRevision,
      shouldAbort: () => !scopeStillCurrent(serial, scope),
      refreshProjects: async (projectPaths) => {
        const refreshed = await mapWithConcurrency(projectPaths, ALL_PROJECTS_CONCURRENCY, async (projectPath) =>
          refreshAllProjectsProjectScan(
            projectPath,
            apiScanProject,
            (path, summaries) => refreshSearchIndex(path, summaries, serial),
            searchIndexRevision,
            () => !scopeStillCurrent(serial, scope)
          )
        );
        return refreshed.filter((result): result is ProjectScanResult => result !== null);
      },
      commit: (finalized) => {
        const healthyProjects = library.projects.filter((project) =>
          finalized.some((result) => result.projectPath === project.path)
        );
        library.allProjectsHealthyPaths = healthyProjects.map((project) => project.path);
        const summaries = aggregateScanResults(finalized);
        library.allPrompts = summaries;
        library.folderPaths = [];
        library.allProjectsWarnings = warnings;
        library.error = null;
        return { summaries, healthyProjects };
      },
    });
    if (!committed || !scopeStillCurrent(serial, scope)) return;

    const { summaries, healthyProjects } = committed;

    const query = library.searchQuery;
    const querySerial = searchSerial;
    if (library.searchQuery.trim()) {
      library.prompts = mergeSearchResults(healthyProjects, searchIndexes, query);
    } else {
      library.prompts = summaries;
    }
    if (!scopeStillCurrent(serial, scope) || querySerial !== searchSerial || query !== library.searchQuery) return;

    const decision = decideSelectedRefresh({
      selectedProjectPath: library.selectedProjectPath,
      selectedName: library.selectedName,
      summaries,
      editorDirty,
      openedFingerprint: selectedOpenedFingerprint,
      reloadSelected,
    });

    if (decision.externalChange) {
      library.externalChangeState = decision.externalChange;
    } else if (decision.reloadSelected) {
      library.externalChangeState = null;
    }

    const selectedName = library.selectedName;
    const selectedProject = library.selectedProjectPath;
    const selectedDocumentSerial = documentSerial;
    if (decision.clearSelection) {
      clearSelectedDocument();
    } else if (
      decision.reloadSelected &&
      selectedName &&
      selectedProject &&
      summariesContainIdentity(summaries, selectedProject, selectedName)
    ) {
      const selected = await apiReadPrompt(selectedProject, selectedName);
      if (
        !scopeStillCurrent(serial, scope) ||
        selectedDocumentSerial !== documentSerial ||
        library.selectedName !== selectedName ||
        library.selectedProjectPath !== selectedProject
      ) return;
      setSelectedDocument(selected);
    }
  } catch (error) {
    if (!scopeStillCurrent(serial, scope)) return;
    library.error = errorText(error);
    library.allPrompts = [];
    library.prompts = [];
  } finally {
    const cleared = finalizeAllProjectsRefreshFlags(serial, loadSerial, library.libraryScope);
    if (cleared) {
      library.loading = cleared.loading;
      library.refreshing = cleared.refreshing;
    }
  }
}

export async function setAllProjectsScope(): Promise<void> {
  library.libraryScope = { kind: 'all-projects' };
  library.folderFilter = '';
  library.error = null;
  await refreshAllProjects();
}

export function projectDisplayName(projectPath: string): string {
  return library.projects.find((project) => project.path === projectPath)?.name ?? projectPath;
}

export async function setActiveProject(path: string): Promise<void> {
  await apiSetActiveProject(path);
  invalidateDocumentLoad();
  library.activeProjectPath = path;
  library.libraryScope = { kind: 'project', projectPath: path };
  library.selectedProjectPath = null;
  library.selectedName = null;
  library.selected = null;
  selectedOpenedFingerprint = null;
  library.externalChangeState = null;
  library.folderFilter = '';
  library.tagFilter = '';
  library.smartView = 'all';
  library.allProjectsWarnings = [];
  const projectRefreshFlags = projectScopeRefreshFlags();
  library.loading = projectRefreshFlags.loading;
  library.refreshing = projectRefreshFlags.refreshing;
  await refreshLibrary();
  await startFilesystemWatch();
}

export async function addProject(name: string, path: string): Promise<Project> {
  const project = await apiAddProject(name, path);
  const roster = await apiListProjects();
  library.projects = roster.projects;
  invalidateDocumentLoad();
  library.activeProjectPath = project.path;
  library.libraryScope = { kind: 'project', projectPath: project.path };
  await apiSetActiveProject(project.path);
  await refreshLibrary();
  await startFilesystemWatch();
  return project;
}

export async function replaceProjectPath(oldPath: string, newPath: string): Promise<Project> {
  const project = await apiReplaceProjectPath(oldPath, newPath);
  const roster = await apiListProjects();
  invalidateDocumentLoad();
  library.projects = roster.projects;
  library.activeProjectPath = roster.active;
  library.libraryScope = roster.active
    ? { kind: 'project', projectPath: roster.active }
    : { kind: 'all-projects' };
  library.selectedProjectPath = null;
  library.selectedName = null;
  library.selected = null;
  selectedOpenedFingerprint = null;
  library.externalChangeState = null;
  library.folderFilter = '';
  library.tagFilter = '';
  library.smartView = 'all';
  await refreshLibrary();
  await startFilesystemWatch();
  return project;
}

export async function renameProjectLabel(name: string, path: string): Promise<Project> {
  const project = await apiRenameProjectLabel(name, path);
  library.projects = library.projects.map((item) => (item.path === project.path ? project : item));
  return project;
}

export async function setProjectColor(path: string, color: string | null): Promise<Project> {
  const project = await apiSetProjectColor(path, color);
  library.projects = library.projects.map((item) => (item.path === project.path ? project : item));
  return project;
}

export async function forgetProject(path: string): Promise<void> {
  await apiRemoveProject(path);
  await refreshProjects({ preserveScope: true });
  await startFilesystemWatch();
}

export async function selectPrompt(project: string, name: string): Promise<void> {
  if (library.libraryScope.kind === 'project' && project !== library.activeProjectPath) return;
  const serial = ++documentSerial;
  invalidateHistoryLoad();
  library.selectedProjectPath = project;
  library.selectedName = name;
  library.selected = null;
  library.loadingDocument = true;
  try {
    const document = await apiReadPrompt(project, name);
    if (serial !== documentSerial || !selectedIdentityMatches(project, name)) return;
    setSelectedDocument(document);
  } catch (error) {
    if (serial === documentSerial && selectedIdentityMatches(project, name)) library.error = errorText(error);
  } finally {
    if (serial === documentSerial) library.loadingDocument = false;
  }
}

export async function loadPromptHistory(project: string, name: string): Promise<void> {
  if (!selectedIdentityMatches(project, name)) return;
  const serial = ++historySerial;
  resetHistoryState();
  library.historyLoading = true;
  try {
    const repo = await apiGitRepositoryInfo(project);
    if (isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)) {
      return;
    }
    library.historyRepo = repo;
    if (!repo.available) {
      library.historyLoading = false;
      return;
    }
    const page = await apiGitFileHistory(project, name);
    if (isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)) {
      return;
    }
    library.historyPage = page;
    if (page.commits.length > 0) {
      await selectHistoryCommit(project, name, page.commits[0], serial);
    }
  } catch (error) {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)
    ) {
      library.historyError = errorText(error);
    }
  } finally {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)
    ) {
      library.historyLoading = false;
    }
  }
}

export async function loadMorePromptHistory(project: string, name: string): Promise<void> {
  if (!selectedIdentityMatches(project, name)) return;
  const page = library.historyPage;
  if (!page?.nextCursor || library.historyLoadingMore) return;
  const serial = historySerial;
  library.historyLoadingMore = true;
  library.historyError = null;
  try {
    const next = await apiGitFileHistory(project, name, undefined, page.nextCursor);
    if (isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)) {
      return;
    }
    const merged = appendHistoryPage(page, next);
    library.historyPage = merged;
  } catch (error) {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)
    ) {
      library.historyError = errorText(error);
    }
  } finally {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.selectedProjectPath, library.selectedName)
    ) {
      library.historyLoadingMore = false;
    }
  }
}

export async function selectHistoryCommit(
  project: string,
  name: string,
  commit: GitFileCommit,
  requestSerial = historySerial
): Promise<void> {
  if (!selectedIdentityMatches(project, name)) return;
  library.historySelectedCommit = commit.hash;
  library.historyDiff = null;
  library.historyDiffLoading = true;
  library.historyError = null;
  try {
    const cacheKey = diffCacheKey(project, name, commit.hash);
    const cached = diffCache.get(cacheKey);
    const diff = cached ?? (await apiGitFileDiff(project, name, commit.hash));
    if (
      isStaleHistoryDiffResponse(
        requestSerial,
        historySerial,
        project,
        name,
        commit.hash,
        library.selectedProjectPath,
        library.selectedName,
        library.historySelectedCommit
      )
    ) {
      return;
    }
    if (!cached) diffCache.set(cacheKey, diff);
    library.historyDiff = diff;
  } catch (error) {
    if (
      !isStaleHistoryDiffResponse(
        requestSerial,
        historySerial,
        project,
        name,
        commit.hash,
        library.selectedProjectPath,
        library.selectedName,
        library.historySelectedCommit
      )
    ) {
      library.historyError = errorText(error);
    }
  } finally {
    if (
      !isStaleHistoryDiffResponse(
        requestSerial,
        historySerial,
        project,
        name,
        commit.hash,
        library.selectedProjectPath,
        library.selectedName,
        library.historySelectedCommit
      )
    ) {
      library.historyDiffLoading = false;
    }
  }
}

export function formatAuthoredAt(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function replaceSummary(summary: PromptSummary, oldName = summary.name): void {
  const replace = (items: PromptSummary[]) =>
    items.map((item) =>
      item.projectPath === summary.projectPath &&
      (item.name === oldName || item.name === summary.name)
        ? summary
        : item
    );
  library.allPrompts = replace(library.allPrompts);
  library.prompts = replace(library.prompts);
}

export async function saveDocument(
  source: PromptDocument,
  body: string,
  metadata: PromptMetadata,
  frontmatterPrefix: string | undefined,
  metadataDirty: boolean,
  expectedRaw: string | undefined
): Promise<PromptDocument> {
  const document = await apiSavePrompt(
    source.projectPath,
    source.name,
    body,
    metadata,
    frontmatterPrefix,
    metadataDirty,
    expectedRaw
  );
  if (selectedIdentityMatches(source.projectPath, source.name)) {
    setSelectedDocument(document);
    replaceSummary(summaryOf(document));
    updateSearchEntry(document);
    if (isAllProjects()) void runSearch();
  } else if (isAllProjects()) {
    updateSearchEntry(document);
    void refreshAllProjects();
  }
  return document;
}

export async function createPrompt(
  projectPath: string,
  name: string,
  body: string,
  metadata: PromptMetadata
): Promise<PromptDocument> {
  const document = await apiCreatePrompt(projectPath, name, body, metadata);
  if (isAllProjects()) {
    await refreshAllProjects();
    setSelectedDocument(document);
  } else if (projectPath === library.activeProjectPath) {
    await refreshLibrary();
    if (projectPath === library.activeProjectPath) {
      setSelectedDocument(document);
    }
  }
  return document;
}

export async function duplicatePrompt(source: PromptDocument, name: string): Promise<PromptDocument> {
  return createPrompt(source.projectPath, name, source.body, cloneMetadata(source.metadata));
}

export async function renamePrompt(source: PromptDocument, newName: string): Promise<PromptDocument> {
  const wasSelected = selectedIdentityMatches(source.projectPath, source.name);
  const document = await apiRenamePrompt(source.projectPath, source.name, newName);
  if (wasSelected) {
    library.selectedProjectPath = document.projectPath;
    library.selectedName = document.name;
  }
  await refreshCurrentScope();
  if (wasSelected) setSelectedDocument(document);
  return document;
}

export async function movePrompt(source: PromptDocument, destination: string): Promise<PromptDocument> {
  const wasSelected = selectedIdentityMatches(source.projectPath, source.name);
  const document = await apiMovePrompt(source.projectPath, source.name, destination);
  if (wasSelected) {
    library.selectedProjectPath = document.projectPath;
    library.selectedName = document.name;
  }
  await refreshCurrentScope();
  if (wasSelected) setSelectedDocument(document);
  return document;
}

export async function deletePrompt(source: PromptDocument): Promise<void> {
  await apiDeletePrompt(source.projectPath, source.name);
  if (selectedIdentityMatches(source.projectPath, source.name)) {
    invalidateDocumentLoad();
    library.selectedProjectPath = null;
    library.selectedName = null;
    library.selected = null;
  }
  await refreshCurrentScope();
}

export async function revealPrompt(source?: PromptDocument): Promise<void> {
  if (!source) return;
  await apiRevealInFinder(source.projectPath, source.name);
}

export async function createFolder(folder: string): Promise<void> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  await apiCreateFolder(library.activeProjectPath, folder);
  await refreshLibrary();
}

export async function renameFolder(folder: string, newFolder: string): Promise<void> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  await apiRenameFolder(library.activeProjectPath, folder, newFolder);
  await refreshLibrary();
}

export async function deleteFolder(folder: string): Promise<void> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  await apiDeleteEmptyFolder(library.activeProjectPath, folder);
  await refreshLibrary();
}

export function setSearchQuery(query: string): void {
  library.searchQuery = query;
  searchSerial++;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), SEARCH_DEBOUNCE_MS);
}

function searchIndexed(project: string, query: string): PromptSummary[] | null {
  return searchProjectIndex(searchIndexes.get(project), query);
}

async function runSearch(): Promise<void> {
  searchTimer = null;
  const serial = searchSerial;
  const query = library.searchQuery.trim();
  if (isAllProjects()) {
    if (!library.projects.length) {
      library.prompts = [];
      return;
    }
    try {
      const results = query
        ? mergeSearchResults(healthyProjectsForSearch(), searchIndexes, query)
        : library.allPrompts;
      if (serial !== searchSerial || !isAllProjects()) return;
      library.prompts = results;
    } catch (error) {
      library.error = errorText(error);
      library.prompts = [];
    }
    return;
  }
  const project = library.activeProjectPath;
  if (!project) {
    library.prompts = [];
    return;
  }
  try {
    const indexed = query ? searchIndexed(project, query) : library.allPrompts;
    const results = indexed ?? (query ? await apiSearchPrompts(project, query) : library.allPrompts);
    if (serial !== searchSerial || project !== library.activeProjectPath) return;
    library.prompts = results;
  } catch (error) {
    library.error = errorText(error);
    library.prompts = [];
  }
}

export function setPaneWidth(which: 'sidebar' | 'library', width: number): void {
  if (which === 'sidebar') library.sidebarWidth = clamp(width, 200, 360);
  else library.libraryWidth = clamp(width, 280, 520);
  saveUiState();
}

export function setSort(sort: PromptSort): void {
  library.sort = sort;
  saveUiState();
}

export function setViewMode(mode: PromptViewMode): void {
  library.viewMode = mode;
  saveUiState();
}

export function buildFolderTree(prompts: PromptSummary[], explicitFolders: string[] = []): FolderNode[] {
  const counts = new Map<string, number>();
  const paths = new Set<string>();
  for (const folder of explicitFolders) {
    const segments = folder.split('/');
    for (let index = 1; index <= segments.length; index++) paths.add(segments.slice(0, index).join('/'));
  }
  for (const prompt of prompts) {
    if (!prompt.folder) continue;
    const segments = prompt.folder.split('/');
    for (let index = 1; index <= segments.length; index++) {
      const path = segments.slice(0, index).join('/');
      paths.add(path);
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  const build = (parent: string): FolderNode[] =>
    [...paths]
      .filter((path) => {
        const prefix = parent ? parent + '/' : '';
        if (!path.startsWith(prefix) || path === parent) return false;
        return !path.slice(prefix.length).includes('/');
      })
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        promptCount: counts.get(path) ?? 0,
        children: build(path),
      }));
  return build('');
}

export function tagCounts(prompts: PromptSummary[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const prompt of prompts) {
    for (const tag of prompt.metadata.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export function promptVariableCount(prompt: PromptSummary): number | null {
  // Reading the version makes this helper reactive when the background index
  // finishes without putting every prompt body into Svelte state.
  library.searchIndexVersion;
  const cached = variableCounts.get(promptKey(prompt.projectPath, prompt.name));
  if (cached !== undefined) return cached;
  if (library.selected?.projectPath === prompt.projectPath && library.selected.name === prompt.name) {
    return parseVariables(library.selected.body).length;
  }
  return null;
}

export function visiblePrompts(): PromptSummary[] {
  const allProjects = isAllProjects();
  const filtered = library.prompts.filter((prompt) => {
    const viewMatches =
      library.smartView === 'all' ||
      (library.smartView === 'favorites' && prompt.metadata.favorite) ||
      (library.smartView === prompt.metadata.status);
    const folderMatches =
      allProjects ||
      !library.folderFilter ||
      prompt.folder === library.folderFilter ||
      prompt.folder.startsWith(library.folderFilter + '/');
    const tagMatches = !library.tagFilter || prompt.metadata.tags.includes(library.tagFilter);
    const modelMatches = !library.modelFilter || prompt.metadata.models.includes(library.modelFilter);
    return viewMatches && folderMatches && tagMatches && modelMatches;
  });
  const sorted = [...filtered];
  if (library.searchQuery.trim() && library.sort === 'modified-desc') return sorted;
  sorted.sort((a, b) => {
    switch (library.sort) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'modified-asc':
        return a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name);
      case 'favorite-first':
        return Number(b.metadata.favorite) - Number(a.metadata.favorite) || a.name.localeCompare(b.name);
      case 'modified-desc':
      default:
        return b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name);
    }
  });
  return sorted;
}

export function promptTitle(name: string): string {
  const stem = name.slice(name.lastIndexOf('/') + 1);
  return stem.replace(/[-_]+/g, ' ');
}

export function formatModifiedAt(timestamp: number): string {
  if (!timestamp) return 'modified unknown';
  const delta = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  if (delta < minute) return 'modified just now';
  if (delta < 60 * minute) return 'modified ' + Math.floor(delta / minute) + 'm ago';
  if (delta < 24 * 60 * minute) return 'modified ' + Math.floor(delta / (60 * minute)) + 'h ago';
  if (delta < 7 * 24 * 60 * minute) return 'modified ' + Math.floor(delta / (24 * 60 * minute)) + 'd ago';
  return 'modified ' + new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function batchUpdate(
  prompts: PromptSummary[],
  update: (metadata: PromptMetadata) => PromptMetadata
): Promise<string[]> {
  const failures: string[] = [];
  for (const prompt of prompts) {
    try {
      const document = await apiReadPrompt(prompt.projectPath, prompt.name);
      await apiSavePrompt(
        prompt.projectPath,
        prompt.name,
        document.body,
        update(cloneMetadata(document.metadata)),
        document.frontmatterPrefix,
        true,
        document.raw
      );
    } catch {
      failures.push(promptKey(prompt.projectPath, prompt.name));
    }
  }
  await refreshCurrentScope();
  return failures;
}

export async function batchDelete(prompts: PromptSummary[]): Promise<string[]> {
  const failures: string[] = [];
  for (const prompt of prompts) {
    try {
      await apiDeletePrompt(prompt.projectPath, prompt.name);
    } catch {
      failures.push(promptKey(prompt.projectPath, prompt.name));
    }
  }
  if (prompts.some((prompt) => selectedIdentityMatches(prompt.projectPath, prompt.name))) {
    invalidateDocumentLoad();
    library.selectedProjectPath = null;
    library.selectedName = null;
    library.selected = null;
  }
  await refreshCurrentScope();
  return failures;
}

export { promptKey };

export { defaultPromptMetadata };
