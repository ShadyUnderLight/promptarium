import {
  addProject as apiAddProject,
  createFolder as apiCreateFolder,
  createPrompt as apiCreatePrompt,
  deleteEmptyFolder as apiDeleteEmptyFolder,
  deletePrompt as apiDeletePrompt,
  listProjects as apiListProjects,
  listFolders as apiListFolders,
  movePrompt as apiMovePrompt,
  readPrompt as apiReadPrompt,
  renameFolder as apiRenameFolder,
  renamePrompt as apiRenamePrompt,
  removeProject as apiRemoveProject,
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
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loadSerial = 0;
let documentSerial = 0;
let searchSerial = 0;

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
    library.projects = result.projects;
    library.activeProjectPath = result.active;
    library.error = null;
    await refreshLibrary();
  } catch (error) {
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
    library.allPrompts = [];
    library.prompts = [];
    library.folderPaths = [];
    library.selected = null;
    library.selectedName = null;
    return;
  }
  library.loading = true;
  try {
    const [summaries, folders] = await Promise.all([apiScanProject(project), apiListFolders(project)]);
    if (serial !== loadSerial) return;
    library.allPrompts = summaries;
    library.folderPaths = folders;
    library.error = null;
    const query = library.searchQuery;
    const querySerial = searchSerial;
    if (library.searchQuery.trim()) {
      library.prompts = await apiSearchPrompts(project, query);
    } else {
      library.prompts = summaries;
    }
    if (serial !== loadSerial || querySerial !== searchSerial || query !== library.searchQuery) return;
    if (library.selectedName && summaries.some((prompt) => prompt.name === library.selectedName)) {
      const selected = await apiReadPrompt(project, library.selectedName);
      if (serial !== loadSerial) return;
      library.selected = selected;
    }
    if (library.selectedName && !summaries.some((prompt) => prompt.name === library.selectedName)) {
      library.selectedName = null;
      library.selected = null;
    }
  } catch (error) {
    if (serial !== loadSerial) return;
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
  library.activeProjectPath = project.path;
  await apiSetActiveProject(project.path);
  await refreshLibrary();
  return project;
}

export async function renameProjectLabel(name: string, path: string): Promise<Project> {
  const project = await apiAddProject(name, path);
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

export async function selectPrompt(name: string): Promise<void> {
  const project = library.activeProjectPath;
  if (!project) return;
  const serial = ++documentSerial;
  library.selectedName = name;
  library.loadingDocument = true;
  try {
    const document = await apiReadPrompt(project, name);
    if (serial !== documentSerial) return;
    library.selected = document;
  } catch (error) {
    if (serial === documentSerial) library.error = errorText(error);
  } finally {
    if (serial === documentSerial) library.loadingDocument = false;
  }
}

function replaceSummary(summary: PromptSummary, oldName = summary.name): void {
  const replace = (items: PromptSummary[]) =>
    items.map((item) => (item.name === oldName || item.name === summary.name ? summary : item));
  library.allPrompts = replace(library.allPrompts);
  library.prompts = replace(library.prompts);
}

export async function saveDocument(
  name: string,
  body: string,
  metadata: PromptMetadata,
  frontmatterPrefix: string | undefined,
  metadataDirty: boolean,
  expectedRaw: string | undefined
): Promise<PromptDocument> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  const document = await apiSavePrompt(
    library.activeProjectPath,
    name,
    body,
    metadata,
    frontmatterPrefix,
    metadataDirty,
    expectedRaw
  );
  library.selected = document;
  library.selectedName = document.name;
  replaceSummary(document);
  return document;
}

export async function createPrompt(
  name: string,
  body: string,
  metadata: PromptMetadata
): Promise<PromptDocument> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  const document = await apiCreatePrompt(library.activeProjectPath, name, body, metadata);
  await refreshLibrary();
  library.selectedName = document.name;
  library.selected = document;
  return document;
}

export async function duplicatePrompt(source: PromptDocument, name: string): Promise<PromptDocument> {
  return createPrompt(name, source.body, cloneMetadata(source.metadata));
}

export async function renamePrompt(name: string, newName: string): Promise<PromptDocument> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  const document = await apiRenamePrompt(library.activeProjectPath, name, newName);
  await refreshLibrary();
  library.selectedName = document.name;
  library.selected = document;
  return document;
}

export async function movePrompt(name: string, destination: string): Promise<PromptDocument> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  const document = await apiMovePrompt(library.activeProjectPath, name, destination);
  await refreshLibrary();
  library.selectedName = document.name;
  library.selected = document;
  return document;
}

export async function deletePrompt(name: string): Promise<void> {
  if (!library.activeProjectPath) throw new Error('Add a prompt project first.');
  await apiDeletePrompt(library.activeProjectPath, name);
  library.selectedName = null;
  library.selected = null;
  await refreshLibrary();
}

export async function revealPrompt(name?: string): Promise<void> {
  if (!library.activeProjectPath) return;
  await apiRevealInFinder(library.activeProjectPath, name);
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
    const results = query ? await apiSearchPrompts(project, query) : library.allPrompts;
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
  if (!library.activeProjectPath) return prompts.map((prompt) => prompt.name);
  for (const prompt of prompts) {
    try {
      const document = await apiReadPrompt(library.activeProjectPath, prompt.name);
      await apiSavePrompt(
        library.activeProjectPath,
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

export async function batchDelete(names: string[]): Promise<string[]> {
  if (!library.activeProjectPath) return [...names];
  const failures: string[] = [];
  for (const name of names) {
    try {
      await apiDeletePrompt(library.activeProjectPath, name);
    } catch {
      failures.push(name);
    }
  }
  await refreshLibrary();
  if (library.selectedName && names.includes(library.selectedName)) {
    library.selectedName = null;
    library.selected = null;
  }
  return failures;
}

export { defaultPromptMetadata };
