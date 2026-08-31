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
} from './api';
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

const SEARCH_DEBOUNCE_MS = 100;

export const library = $state({
  projects: [] as Project[],
  activeProjectPath: null as string | null,
  allPrompts: [] as PromptSummary[],
  prompts: [] as PromptSummary[],
  selectedName: null as string | null,
  selected: null as PromptDocument | null,
  loading: false,
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
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadSerial = 0;
let documentSerial = 0;
let searchSerial = 0;
let historySerial = 0;

const historyCache = new Map<string, GitFileHistoryPage>();
const diffCache = new Map<string, GitFileDiff>();

interface SearchEntry {
  summary: PromptSummary;
  bodyLower: string;
  variableCount?: number;
}

const searchIndexes = new Map<string, Map<string, SearchEntry>>();
const variableCounts = new Map<string, number>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  return {
    projectPath: document.projectPath,
    relativePath: document.relativePath,
    name: document.name,
    folder: document.folder,
    extension: document.extension,
    metadata: document.metadata,
    modifiedAt: document.modifiedAt,
    hasFrontmatter: document.hasFrontmatter,
    frontmatterError: document.frontmatterError,
  };
}

function promptKey(projectPath: string, name: string): string {
  return projectPath + '\u0000' + name;
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

function invalidateSearchIndex(projectPath: string): void {
  searchIndexes.delete(projectPath);
  const prefix = projectPath + '\u0000';
  for (const key of variableCounts.keys()) {
    if (key.startsWith(prefix)) variableCounts.delete(key);
  }
  library.searchIndexVersion++;
}

function updateSearchEntry(document: PromptDocument): void {
  const index = searchIndexes.get(document.projectPath);
  if (!index) return;
  const variableCount = parseVariables(document.body).length;
  const entry: SearchEntry = {
    summary: summaryOf(document),
    bodyLower: document.body.toLowerCase(),
    variableCount,
  };
  index.set(document.name, entry);
  variableCounts.set(promptKey(document.projectPath, document.name), variableCount);
  library.searchIndexVersion++;
}

async function rebuildSearchIndex(
  projectPath: string,
  summaries: PromptSummary[],
  serial: number
): Promise<void> {
  const index = new Map<string, SearchEntry>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < summaries.length) {
      const prompt = summaries[next++];
      const fallback: SearchEntry = {
        summary: prompt,
        bodyLower: '',
      };
      try {
        const document = await apiReadPrompt(projectPath, prompt.name);
        fallback.summary = summaryOf(document);
        fallback.bodyLower = document.body.toLowerCase();
        fallback.variableCount = parseVariables(document.body).length;
      } catch {
        // The summary is still useful for name/path/metadata search when a file
        // disappears between scan and index construction.
      }
      index.set(prompt.name, fallback);
    }
  };
  const workers = Math.min(8, Math.max(1, summaries.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (serial !== loadSerial || projectPath !== library.activeProjectPath) return;
  searchIndexes.set(projectPath, index);
  const prefix = projectPath + '\u0000';
  for (const key of variableCounts.keys()) {
    if (key.startsWith(prefix)) variableCounts.delete(key);
  }
  for (const entry of index.values()) {
    if (entry.variableCount !== undefined) {
      variableCounts.set(promptKey(projectPath, entry.summary.name), entry.variableCount);
    }
  }
  library.searchIndexVersion++;
  if (library.searchQuery.trim()) void runSearch();
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
}

export async function refreshProjects(): Promise<void> {
  try {
    const result = await apiListProjects();
    if (result.active !== library.activeProjectPath) {
      invalidateDocumentLoad();
      library.selectedName = null;
      library.selected = null;
    }
    library.projects = result.projects;
    library.activeProjectPath = result.active;
    library.error = null;
    await refreshLibrary();
  } catch (error) {
    invalidateDocumentLoad();
    library.error = errorText(error);
    library.projects = [];
    library.activeProjectPath = null;
    library.allPrompts = [];
    library.prompts = [];
    library.folderPaths = [];
    library.selected = null;
  }
}

export async function refreshLibrary(): Promise<void> {
  const project = library.activeProjectPath;
  const serial = ++loadSerial;
  if (!project) {
    invalidateDocumentLoad();
    library.allPrompts = [];
    library.prompts = [];
    library.folderPaths = [];
    library.selected = null;
    library.selectedName = null;
    return;
  }
  library.loading = true;
  invalidateSearchIndex(project);
  try {
    const [summaries, folders] = await Promise.all([apiScanProject(project), apiListFolders(project)]);
    if (serial !== loadSerial) return;
    library.allPrompts = summaries;
    library.folderPaths = folders;
    library.error = null;
    void rebuildSearchIndex(project, summaries, serial);
    const query = library.searchQuery;
    const querySerial = searchSerial;
    if (library.searchQuery.trim()) {
      library.prompts = await apiSearchPrompts(project, query);
    } else {
      library.prompts = summaries;
    }
    if (serial !== loadSerial || querySerial !== searchSerial || query !== library.searchQuery) return;
    const selectedName = library.selectedName;
    const selectedDocumentSerial = documentSerial;
    if (selectedName && summaries.some((prompt) => prompt.name === selectedName)) {
      const selected = await apiReadPrompt(project, selectedName);
      if (
        serial !== loadSerial ||
        project !== library.activeProjectPath ||
        selectedDocumentSerial !== documentSerial ||
        library.selectedName !== selectedName
      ) return;
      library.selected = selected;
    }
    if (library.selectedName && !summaries.some((prompt) => prompt.name === library.selectedName)) {
      library.selectedName = null;
      library.selected = null;
    }
  } catch (error) {
    if (serial !== loadSerial || project !== library.activeProjectPath) return;
    library.error = errorText(error);
    library.allPrompts = [];
    library.prompts = [];
    if (library.error.toLowerCase().includes('not found')) {
      library.selected = null;
    }
  } finally {
    if (serial === loadSerial) library.loading = false;
  }
}

export async function setActiveProject(path: string): Promise<void> {
  await apiSetActiveProject(path);
  invalidateDocumentLoad();
  library.activeProjectPath = path;
  library.selectedName = null;
  library.selected = null;
  library.folderFilter = '';
  library.tagFilter = '';
  library.smartView = 'all';
  await refreshLibrary();
}

export async function addProject(name: string, path: string): Promise<Project> {
  const project = await apiAddProject(name, path);
  const roster = await apiListProjects();
  library.projects = roster.projects;
  invalidateDocumentLoad();
  library.activeProjectPath = project.path;
  await apiSetActiveProject(project.path);
  await refreshLibrary();
  return project;
}

export async function replaceProjectPath(oldPath: string, newPath: string): Promise<Project> {
  const project = await apiReplaceProjectPath(oldPath, newPath);
  const roster = await apiListProjects();
  invalidateDocumentLoad();
  library.projects = roster.projects;
  library.activeProjectPath = roster.active;
  library.selectedName = null;
  library.selected = null;
  library.folderFilter = '';
  library.tagFilter = '';
  library.smartView = 'all';
  await refreshLibrary();
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
  await refreshProjects();
}

export async function selectPrompt(project: string, name: string): Promise<void> {
  if (project !== library.activeProjectPath) return;
  const serial = ++documentSerial;
  invalidateHistoryLoad();
  library.selectedName = name;
  library.selected = null;
  library.loadingDocument = true;
  try {
    const document = await apiReadPrompt(project, name);
    if (serial !== documentSerial || project !== library.activeProjectPath) return;
    library.selected = document;
  } catch (error) {
    if (serial === documentSerial && project === library.activeProjectPath) library.error = errorText(error);
  } finally {
    if (serial === documentSerial) library.loadingDocument = false;
  }
}

export async function loadPromptHistory(project: string, name: string): Promise<void> {
  if (project !== library.activeProjectPath || library.selectedName !== name) return;
  const serial = ++historySerial;
  resetHistoryState();
  library.historyLoading = true;
  try {
    const cacheKey = promptKey(project, name);
    const cached = historyCache.get(cacheKey);
    const repo = await apiGitRepositoryInfo(project);
    if (isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)) {
      return;
    }
    library.historyRepo = repo;
    if (!repo.available) {
      library.historyLoading = false;
      return;
    }
    const page = cached ?? (await apiGitFileHistory(project, name));
    if (isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)) {
      return;
    }
    if (!cached) historyCache.set(cacheKey, page);
    library.historyPage = page;
    if (page.commits.length > 0) {
      await selectHistoryCommit(project, name, page.commits[0], serial);
    }
  } catch (error) {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)
    ) {
      library.historyError = errorText(error);
    }
  } finally {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)
    ) {
      library.historyLoading = false;
    }
  }
}

export async function loadMorePromptHistory(project: string, name: string): Promise<void> {
  if (project !== library.activeProjectPath || library.selectedName !== name) return;
  const page = library.historyPage;
  if (!page?.nextCursor || library.historyLoadingMore) return;
  const serial = historySerial;
  library.historyLoadingMore = true;
  library.historyError = null;
  try {
    const next = await apiGitFileHistory(project, name, undefined, page.nextCursor);
    if (isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)) {
      return;
    }
    const merged = appendHistoryPage(page, next);
    library.historyPage = merged;
    historyCache.set(promptKey(project, name), merged);
  } catch (error) {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)
    ) {
      library.historyError = errorText(error);
    }
  } finally {
    if (
      !isStaleHistoryResponse(serial, historySerial, project, name, library.activeProjectPath, library.selectedName)
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
  if (project !== library.activeProjectPath || library.selectedName !== name) return;
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
        library.activeProjectPath,
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
        library.activeProjectPath,
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
        library.activeProjectPath,
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
  if (source.projectPath === library.activeProjectPath && library.selectedName === source.name) {
    library.selected = document;
    library.selectedName = document.name;
    replaceSummary(summaryOf(document));
    updateSearchEntry(document);
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
  if (projectPath === library.activeProjectPath) {
    await refreshLibrary();
    if (projectPath === library.activeProjectPath) {
      library.selectedName = document.name;
      library.selected = document;
    }
  }
  return document;
}

export async function duplicatePrompt(source: PromptDocument, name: string): Promise<PromptDocument> {
  return createPrompt(source.projectPath, name, source.body, cloneMetadata(source.metadata));
}

export async function renamePrompt(source: PromptDocument, newName: string): Promise<PromptDocument> {
  const wasSelected = source.projectPath === library.activeProjectPath && library.selectedName === source.name;
  const document = await apiRenamePrompt(source.projectPath, source.name, newName);
  if (wasSelected && source.projectPath === library.activeProjectPath) {
    await refreshLibrary();
    if (
      source.projectPath === library.activeProjectPath &&
      (library.selectedName === source.name || library.selectedName === null)
    ) {
      library.selectedName = document.name;
      library.selected = document;
    }
  }
  return document;
}

export async function movePrompt(source: PromptDocument, destination: string): Promise<PromptDocument> {
  const wasSelected = source.projectPath === library.activeProjectPath && library.selectedName === source.name;
  const document = await apiMovePrompt(source.projectPath, source.name, destination);
  if (wasSelected && source.projectPath === library.activeProjectPath) {
    await refreshLibrary();
    if (
      source.projectPath === library.activeProjectPath &&
      (library.selectedName === source.name || library.selectedName === null)
    ) {
      library.selectedName = document.name;
      library.selected = document;
    }
  }
  return document;
}

export async function deletePrompt(source: PromptDocument): Promise<void> {
  await apiDeletePrompt(source.projectPath, source.name);
  if (source.projectPath === library.activeProjectPath) {
    invalidateDocumentLoad();
    if (library.selected?.projectPath === source.projectPath && library.selected.name === source.name) {
      library.selectedName = null;
      library.selected = null;
    }
    await refreshLibrary();
  }
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

function searchFieldScore(token: string, value: string, weight: number): number | null {
  const lower = value.toLowerCase();
  if (!lower.includes(token)) return null;
  let score = weight;
  if (lower === token) score += weight;
  else if (lower.startsWith(token)) score += weight * 0.55;
  else if (lower.split(/[^\p{L}\p{N}]+/u).some((word) => word === token)) score += weight * 0.35;
  return score;
}

function searchIndexed(project: string, query: string): PromptSummary[] | null {
  const index = searchIndexes.get(project);
  if (!index) return null;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return library.allPrompts;
  const matches: Array<{ summary: PromptSummary; score: number }> = [];
  for (const entry of index.values()) {
    const fields = [
      [entry.summary.name, 100],
      [entry.summary.relativePath, 95],
      [entry.summary.metadata.tags.join(' '), 60],
      [entry.summary.metadata.description, 45],
      [entry.summary.metadata.models.join(' '), 35],
      [entry.bodyLower, 20],
    ] as const;
    let total = 0;
    let matched = true;
    for (const token of tokens) {
      let best = 0;
      for (const [value, weight] of fields) {
        best = Math.max(best, searchFieldScore(token, value, weight) ?? 0);
      }
      if (!best) {
        matched = false;
        break;
      }
      total += best;
    }
    if (matched) matches.push({ summary: entry.summary, score: total / tokens.length });
  }
  return matches
    .sort((a, b) => b.score - a.score || a.summary.name.localeCompare(b.summary.name))
    .map((match) => match.summary);
}

async function runSearch(): Promise<void> {
  searchTimer = null;
  const serial = searchSerial;
  const project = library.activeProjectPath;
  if (!project) {
    library.prompts = [];
    return;
  }
  const query = library.searchQuery.trim();
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
  const filtered = library.prompts.filter((prompt) => {
    const viewMatches =
      library.smartView === 'all' ||
      (library.smartView === 'favorites' && prompt.metadata.favorite) ||
      (library.smartView === prompt.metadata.status);
    const folderMatches =
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
      failures.push(prompt.name);
    }
  }
  await refreshLibrary();
  return failures;
}

export async function batchDelete(prompts: PromptSummary[]): Promise<string[]> {
  const failures: string[] = [];
  for (const prompt of prompts) {
    try {
      await apiDeletePrompt(prompt.projectPath, prompt.name);
    } catch {
      failures.push(prompt.name);
    }
  }
  if (prompts.some((prompt) => prompt.projectPath === library.activeProjectPath)) {
    await refreshLibrary();
    const selected = library.selected;
    if (selected && prompts.some((prompt) => prompt.projectPath === selected.projectPath && prompt.name === selected.name)) {
      invalidateDocumentLoad();
      library.selectedName = null;
      library.selected = null;
    }
  }
  return failures;
}

export { defaultPromptMetadata };
