/**
 * TypeScript bridge to the narrow Tauri prompt-library seam.
 *
 * Browser development uses an in-memory fixture with the same document model.
 * The desktop path never exposes a generic filesystem writer: Rust validates
 * every project and relative path before touching user data.
 */
import type {
  Project,
  ProjectList,
  PromptDocument,
  PromptMetadata,
  PromptSummary,
} from './prompts/types';
import type { GitFileDiff, GitFileHistoryPage, GitRepositoryInfo } from './prompts/git-types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function listProjects(): Promise<ProjectList> {
  if (!isTauri()) return { projects: devProjects.map((project) => ({ ...project })), active: devActive };
  return call<ProjectList>('list_projects');
}

export async function addProject(name: string, path: string): Promise<Project> {
  if (!isTauri()) return devAddProject(name, path);
  return call<Project>('add_project', { name, path });
}

export async function replaceProjectPath(oldPath: string, newPath: string): Promise<Project> {
  if (!isTauri()) return devReplaceProjectPath(oldPath, newPath);
  return call<Project>('replace_project_path', { oldPath, newPath });
}

export async function renameProjectLabel(name: string, path: string): Promise<Project> {
  if (!isTauri()) return devRenameProjectLabel(name, path);
  return call<Project>('rename_project_label', { path, name });
}

export async function setProjectColor(path: string, color: string | null): Promise<Project> {
  if (!isTauri()) return devSetProjectColor(path, color);
  return call<Project>('set_project_color', { path, color });
}

export async function removeProject(path: string): Promise<void> {
  if (!isTauri()) {
    devRemoveProject(path);
    return;
  }
  await call<null>('remove_project', { path });
}

export async function setActiveProject(path: string): Promise<void> {
  if (!isTauri()) {
    devActive = path;
    return;
  }
  await call<null>('set_active_project', { path });
}

export interface ProjectFsChangedEvent {
  projectPath: string;
  sequence: number;
}

export interface ProjectFsWatchErrorEvent {
  projectPath: string | null;
  message: string;
}

export interface ProjectWatcherStatus {
  projectPath: string | null;
  available: boolean;
  message?: string | null;
}

export async function syncProjectWatcher(project: string | null): Promise<ProjectWatcherStatus> {
  if (!isTauri()) {
    return { projectPath: project, available: true, message: null };
  }
  return call<ProjectWatcherStatus>('sync_project_watcher', { project });
}

export async function listenProjectFsChanged(
  listener: (event: ProjectFsChangedEvent) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<ProjectFsChangedEvent>('project-fs-changed', (payload) => {
    listener(payload.payload);
  });
  return unlisten;
}

export async function listenProjectFsWatchError(
  listener: (event: ProjectFsWatchErrorEvent) => void
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<ProjectFsWatchErrorEvent>('project-fs-watch-error', (payload) => {
    listener(payload.payload);
  });
  return unlisten;
}

export async function scanProject(project: string): Promise<PromptSummary[]> {
  if (!isTauri()) return devScanProject(project);
  return call<PromptSummary[]>('scan_project', { project });
}

export async function listFolders(project: string): Promise<string[]> {
  if (!isTauri()) return devFolderPaths(project);
  return call<string[]>('scan_folders', { project });
}

export async function readPrompt(project: string, name: string): Promise<PromptDocument> {
  if (!isTauri()) return devReadPrompt(project, name);
  return call<PromptDocument>('read_prompt', { project, name });
}

export async function createPrompt(
  project: string,
  name: string,
  body: string,
  metadata: PromptMetadata
): Promise<PromptDocument> {
  if (!isTauri()) return devCreatePrompt(project, name, body, metadata);
  return call<PromptDocument>('create_prompt', { project, name, body, metadata });
}

export async function savePrompt(
  project: string,
  name: string,
  body: string,
  metadata: PromptMetadata,
  frontmatterPrefix: string | undefined,
  metadataDirty: boolean,
  expectedRaw: string | undefined
): Promise<PromptDocument> {
  if (!isTauri()) return devSavePrompt(project, name, body, metadata);
  return call<PromptDocument>('save_prompt', {
    project,
    name,
    body,
    metadata,
    frontmatterPrefix,
    metadataDirty,
    expectedRaw,
  });
}

export async function renamePrompt(project: string, name: string, newName: string): Promise<PromptDocument> {
  if (!isTauri()) return devRenamePrompt(project, name, newName);
  return call<PromptDocument>('rename_prompt', { project, name, newName });
}

export async function movePrompt(project: string, name: string, destination: string): Promise<PromptDocument> {
  if (!isTauri()) return devRenamePrompt(project, name, destination);
  return call<PromptDocument>('move_prompt', { project, name, destination });
}

export async function deletePrompt(project: string, name: string): Promise<void> {
  if (!isTauri()) {
    devDeletePrompt(project, name);
    return;
  }
  await call<null>('delete_prompt', { project, name });
}

export async function createFolder(project: string, folder: string): Promise<void> {
  if (!isTauri()) {
    devCreateFolder(project, folder);
    return;
  }
  await call<null>('create_folder', { project, folder });
}

export async function renameFolder(project: string, folder: string, newFolder: string): Promise<void> {
  if (!isTauri()) {
    devRenameFolder(project, folder, newFolder);
    return;
  }
  await call<null>('rename_folder', { project, folder, newFolder });
}

export async function deleteEmptyFolder(project: string, folder: string): Promise<void> {
  if (!isTauri()) {
    devDeleteFolder(project, folder);
    return;
  }
  await call<null>('delete_empty_folder', { project, folder });
}

export async function searchPrompts(project: string, query: string): Promise<PromptSummary[]> {
  if (!isTauri()) return devSearchProject(project, query);
  return call<PromptSummary[]>('search_prompts', { project, query });
}

export async function revealInFinder(project: string, name?: string): Promise<void> {
  if (!isTauri()) return;
  await call<null>('reveal_in_finder', { project, name });
}

export async function gitRepositoryInfo(project: string): Promise<GitRepositoryInfo> {
  if (!isTauri()) return { available: false, reason: 'not-a-repository' };
  return call<GitRepositoryInfo>('git_repository_info', { project });
}

export async function gitFileHistory(
  project: string,
  name: string,
  limit?: number,
  cursor?: string
): Promise<GitFileHistoryPage> {
  if (!isTauri()) return { commits: [], tracked: false };
  return call<GitFileHistoryPage>('git_file_history', { project, name, limit, cursor });
}

export async function gitFileDiff(
  project: string,
  name: string,
  commit: string
): Promise<GitFileDiff> {
  if (!isTauri()) return { commit, patch: '' };
  return call<GitFileDiff>('git_file_diff', { project, name, commit });
}

interface DevPrompt {
  name: string;
  content: string;
}

const devProjects: Project[] = [
  { name: 'engineering', path: '/dev/mock/engineering' },
  { name: 'writing', path: '/dev/mock/writing' },
  { name: 'research', path: '/dev/mock/research' },
];

let devActive: string | null = '/dev/mock/engineering';

const devStore: Record<string, DevPrompt[]> = {
  '/dev/mock/engineering': [
    {
      name: 'review/senior-reviewer',
      content: 'You are a senior reviewer. Be rigorous about correctness, but do not nitpick style that a formatter owns. Say plainly when something is fine.',
    },
    {
      name: 'review/pr-checklist',
      content: 'Review the PR for {ticket}. Focus especially on {concern}. Check error handling, tests, and naming. Flag anything that reads as a silent failure.',
    },
    {
      name: 'debug/bug-repro-first',
      content: 'Before proposing a fix for {symptom}, write the smallest failing test that reproduces it. If you cannot reproduce it, say so instead of guessing.',
    },
    {
      name: 'testing/test-plan',
      content: 'Write a test plan for {surface}. Cover the happy path once, then spend the rest of your effort on {risk} — the cases where a bug would be silent.',
    },
    {
      name: 'refactor/refactor-safely',
      content: 'Refactor {target} without changing behavior. Land the characterization tests first, then move code. If a test is hard to write, that is the design talking.',
    },
    {
      name: 'code/format-string',
      content: 'A body is a Python-style format string: {name} is substituted uniformly, including code fences. To emit a literal brace, double it.',
    },
    {
      name: 'release-notes-draft',
      content: 'Draft release notes for {version}. Lead with what a user can now do that they could not before. Migrations and breaking changes go first, not last.',
    },
    { name: 'style/be-terse', content: 'Be terse and concrete. Lead with the answer; skip preamble and hedging.' },
  ],
  '/dev/mock/writing': [
    { name: 'tone-notes', content: 'Prefer plain words over jargon. Say {audience} when addressing the reader.' },
    {
      name: 'headline-rewrite',
      content: 'Rewrite {draft} three ways: one that states the outcome, one that names the reader, one that asks the question they already have. No clickbait.',
    },
    {
      name: 'cut-it-in-half',
      content: 'Cut this by half without losing an idea. Delete throat-clearing, restatement, and any sentence that only announces the next one.',
    },
    {
      name: 'explain-like-staff-eng',
      content: 'Explain {topic} to a strong engineer who has never touched it. Lead with what it is for, then how it works. No analogies to food.',
    },
  ],
  '/dev/mock/research': [
    {
      name: 'literature-scan',
      content: 'Survey the {n} strongest sources on {question}. For each: the claim, the evidence, and the strongest objection to it. Mark what you could not verify.',
    },
    {
      name: 'steelman-then-rebut',
      content: 'State the strongest version of {claim} — the one its smartest advocate would recognize. Only then argue against it. A rebuttal of a weak version proves nothing.',
    },
    {
      name: 'weekend-scope-guard',
      content: 'This is a weekend project. Name the one thing it must do by Sunday, and the things you are deliberately not building.',
    },
  ],
};

const devMetadata: Record<string, PromptMetadata> = {
  '/dev/mock/engineering::review/senior-reviewer': {
    description: 'A rigorous correctness-first review pass for production code.',
    tags: ['coding', 'review'],
    status: 'active',
    favorite: true,
    models: ['ChatGPT', 'Claude'],
    created: '2026-08-20',
    extra: {},
  },
  '/dev/mock/engineering::review/pr-checklist': {
    description: 'Review a pull request for regressions, missing tests and silent failures.',
    tags: ['coding', 'review', 'github'],
    status: 'active',
    favorite: true,
    models: ['ChatGPT'],
    created: '2026-08-08',
    extra: {},
  },
  '/dev/mock/engineering::debug/bug-repro-first': {
    description: 'Turn a symptom into a smallest failing reproduction before proposing a fix.',
    tags: ['coding', 'debugging'],
    status: 'draft',
    favorite: false,
    models: ['Claude'],
    created: '2026-08-12',
    extra: {},
  },
  '/dev/mock/engineering::testing/test-plan': {
    description: 'A focused test plan that spends attention on silent failure modes.',
    tags: ['coding', 'testing'],
    status: 'active',
    favorite: false,
    models: ['ChatGPT'],
    created: '2026-08-05',
    extra: {},
  },
  '/dev/mock/engineering::refactor/refactor-safely': {
    description: 'Characterize behavior before moving code during a refactor.',
    tags: ['coding', 'refactor'],
    status: 'archived',
    favorite: false,
    models: [],
    created: '2026-07-20',
    extra: {},
  },
  '/dev/mock/engineering::code/format-string': {
    description: 'Explain the one variable grammar used by Prompt Library.',
    tags: ['documentation', 'variables'],
    status: 'active',
    favorite: false,
    models: ['ChatGPT'],
    created: '2026-08-02',
    extra: {},
  },
  '/dev/mock/engineering::release-notes-draft': {
    description: 'Draft concise release notes with migrations and breaking changes first.',
    tags: ['writing', 'release'],
    status: 'draft',
    favorite: false,
    models: [],
    created: '2026-08-17',
    extra: {},
  },
  '/dev/mock/engineering::style/be-terse': {
    description: 'A compact style guide for direct answers.',
    tags: ['style'],
    status: 'active',
    favorite: false,
    models: [],
    extra: {},
  },
  '/dev/mock/writing::tone-notes': {
    description: 'Use plain words and adapt the tone to the intended reader.',
    tags: ['writing', 'tone'],
    status: 'active',
    favorite: true,
    models: ['ChatGPT'],
    created: '2026-08-15',
    extra: {},
  },
  '/dev/mock/writing::headline-rewrite': {
    description: 'Generate three outcome-led, reader-aware headline options.',
    tags: ['writing', 'headline'],
    status: 'active',
    favorite: false,
    models: ['ChatGPT', 'Claude'],
    created: '2026-08-11',
    extra: {},
  },
  '/dev/mock/writing::cut-it-in-half': {
    description: 'Remove throat-clearing and repetition without losing ideas.',
    tags: ['writing', 'editing'],
    status: 'active',
    favorite: false,
    models: [],
    extra: {},
  },
  '/dev/mock/writing::explain-like-staff-eng': {
    description: 'Explain a technical topic to a strong engineer who is new to it.',
    tags: ['writing', 'explanation'],
    status: 'draft',
    favorite: false,
    models: [],
    extra: {},
  },
  '/dev/mock/research::literature-scan': {
    description: 'Survey sources, evidence and the strongest objection to each claim.',
    tags: ['research', 'sources'],
    status: 'active',
    favorite: true,
    models: ['ChatGPT'],
    created: '2026-08-01',
    extra: {},
  },
  '/dev/mock/research::steelman-then-rebut': {
    description: 'State the strongest version of a claim before arguing against it.',
    tags: ['research', 'reasoning'],
    status: 'active',
    favorite: false,
    models: [],
    extra: {},
  },
  '/dev/mock/research::weekend-scope-guard': {
    description: 'Keep a weekend project focused on one outcome and explicit non-goals.',
    tags: ['planning', 'scope'],
    status: 'archived',
    favorite: false,
    models: [],
    extra: {},
  },
};

const devFolders: Record<string, Set<string>> = {};
const devMtimes: Record<string, number> = {};
let devClock = Date.now();

function cloneMetadata(metadata: PromptMetadata | undefined): PromptMetadata {
  const value = metadata ?? {
    description: '',
    tags: [],
    status: 'active' as const,
    favorite: false,
    models: [],
    extra: {},
  };
  return {
    ...value,
    tags: [...value.tags],
    models: [...value.models],
    extra: { ...value.extra },
  };
}

function hasMetadata(metadata: PromptMetadata): boolean {
  return Boolean(
    metadata.description ||
      metadata.tags.length ||
      metadata.status !== 'active' ||
      metadata.favorite ||
      metadata.models.length ||
      metadata.created ||
      Object.keys(metadata.extra).length
  );
}

function devPrompts(project: string): DevPrompt[] {
  return (devStore[project] ??= []);
}

function devSummary(project: string, snippet: DevPrompt): PromptSummary {
  const key = project + '::' + snippet.name;
  const metadata = cloneMetadata(devMetadata[key]);
  devMtimes[key] ??= metadata.created ? new Date(metadata.created).getTime() : devClock--;
  const folder = snippet.name.includes('/') ? snippet.name.slice(0, snippet.name.lastIndexOf('/')) : '';
  return {
    projectPath: project,
    relativePath: snippet.name + '.md',
    name: snippet.name,
    folder,
    extension: '.md',
    metadata,
    modifiedAt: devMtimes[key],
    sizeBytes: new TextEncoder().encode(snippet.content).length,
    hasFrontmatter: hasMetadata(metadata),
  };
}

function devDocument(project: string, snippet: DevPrompt): PromptDocument {
  return { ...devSummary(project, snippet), body: snippet.content, raw: snippet.content };
}

function devScanProject(project: string): PromptSummary[] {
  return devPrompts(project).map((snippet) => devSummary(project, snippet));
}

function devReadPrompt(project: string, name: string): PromptDocument {
  const snippet = devPrompts(project).find((item) => item.name === name);
  if (!snippet) throw new Error('prompt file not found: ' + name + '.md');
  return devDocument(project, snippet);
}

function devCreatePrompt(project: string, name: string, body: string, metadata: PromptMetadata): PromptDocument {
  if (devPrompts(project).some((item) => item.name === name)) throw new Error('prompt already exists: ' + name);
  const snippet = { name, content: body };
  devPrompts(project).push(snippet);
  devMetadata[project + '::' + name] = cloneMetadata(metadata);
  return devDocument(project, snippet);
}

function devSavePrompt(project: string, name: string, body: string, metadata: PromptMetadata): PromptDocument {
  const snippet = devReadPrompt(project, name);
  const current = devPrompts(project).find((item) => item.name === name);
  if (!current) throw new Error('prompt file not found: ' + name + '.md');
  current.content = body;
  devMetadata[project + '::' + name] = cloneMetadata(metadata);
  devMtimes[project + '::' + name] = Date.now();
  return { ...snippet, ...devSummary(project, current), body, raw: body };
}

function devRenamePrompt(project: string, name: string, newName: string): PromptDocument {
  const snippet = devPrompts(project).find((item) => item.name === name);
  if (!snippet) throw new Error('prompt file not found: ' + name + '.md');
  if (devPrompts(project).some((item) => item.name === newName)) throw new Error('prompt already exists: ' + newName);
  const oldKey = project + '::' + name;
  const newKey = project + '::' + newName;
  snippet.name = newName;
  devMetadata[newKey] = cloneMetadata(devMetadata[oldKey]);
  devMtimes[newKey] = devMtimes[oldKey] ?? Date.now();
  delete devMetadata[oldKey];
  delete devMtimes[oldKey];
  return devDocument(project, snippet);
}

function devDeletePrompt(project: string, name: string): void {
  const snippets = devPrompts(project);
  const index = snippets.findIndex((item) => item.name === name);
  if (index >= 0) snippets.splice(index, 1);
  delete devMetadata[project + '::' + name];
  delete devMtimes[project + '::' + name];
}

function devFolderPaths(project: string): string[] {
  const paths = new Set(devFolders[project] ?? []);
  for (const snippet of devPrompts(project)) {
    if (!snippet.name.includes('/')) continue;
    const segments = snippet.name.split('/');
    for (let index = 1; index < segments.length; index++) paths.add(segments.slice(0, index).join('/'));
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function devCreateFolder(project: string, folder: string): void {
  devFolders[project] ??= new Set();
  const segments = folder.split('/').filter(Boolean);
  for (let index = 1; index <= segments.length; index++) devFolders[project].add(segments.slice(0, index).join('/'));
}

function devRenameFolder(project: string, folder: string, next: string): void {
  const folders = devFolders[project] ?? new Set<string>();
  const moved = [...folders].filter((item) => item === folder || item.startsWith(folder + '/'));
  for (const item of moved) folders.delete(item);
  for (const item of moved) folders.add(next + item.slice(folder.length));
  for (const snippet of devPrompts(project)) {
    if (snippet.name !== folder && !snippet.name.startsWith(folder + '/')) continue;
    const oldName = snippet.name;
    const newName = next + oldName.slice(folder.length);
    const oldKey = project + '::' + oldName;
    const newKey = project + '::' + newName;
    devMetadata[newKey] = cloneMetadata(devMetadata[oldKey]);
    devMtimes[newKey] = devMtimes[oldKey] ?? Date.now();
    delete devMetadata[oldKey];
    delete devMtimes[oldKey];
    snippet.name = newName;
  }
  devFolders[project] = folders;
}

function devDeleteFolder(project: string, folder: string): void {
  if (devPrompts(project).some((item) => item.name === folder || item.name.startsWith(folder + '/'))) {
    throw new Error('folder is not empty: ' + folder);
  }
  devFolders[project]?.delete(folder);
}

function devAddProject(name: string, path: string): Project {
  const existing = devProjects.find((project) => project.path === path);
  if (existing) {
    existing.name = name;
    return { ...existing };
  }
  const project = { name, path };
  devProjects.push(project);
  devStore[path] ??= [];
  devActive = path;
  return { ...project };
}

function devReplaceProjectPath(oldPath: string, newPath: string): Project {
  const project = devProjects.find((item) => item.path === oldPath);
  if (!project) throw new Error('not a known project: ' + oldPath);
  if (devProjects.some((item) => item.path === newPath)) {
    throw new Error('project path already registered: ' + newPath);
  }
  project.path = newPath;
  devStore[newPath] = devStore[oldPath] ?? [];
  devFolders[newPath] = devFolders[oldPath] ?? new Set();
  delete devStore[oldPath];
  delete devFolders[oldPath];
  if (devActive === oldPath) devActive = newPath;
  for (const prompt of devStore[newPath]) {
    const oldKey = oldPath + '::' + prompt.name;
    const newKey = newPath + '::' + prompt.name;
    devMetadata[newKey] = cloneMetadata(devMetadata[oldKey]);
    devMtimes[newKey] = devMtimes[oldKey] ?? Date.now();
    delete devMetadata[oldKey];
    delete devMtimes[oldKey];
  }
  return { ...project };
}

function devRenameProjectLabel(name: string, path: string): Project {
  const project = devProjects.find((item) => item.path === path);
  if (!project) throw new Error('not a known project: ' + path);
  if (!name.trim()) throw new Error('project name cannot be empty');
  project.name = name.trim();
  return { ...project };
}

function devSetProjectColor(path: string, color: string | null): Project {
  const project = devProjects.find((item) => item.path === path);
  if (!project) throw new Error('not a known project: ' + path);
  project.color = color ?? undefined;
  return { ...project };
}

function devRemoveProject(path: string): void {
  const index = devProjects.findIndex((project) => project.path === path);
  if (index < 0) return;
  devProjects.splice(index, 1);
  if (devActive === path) devActive = devProjects[0]?.path ?? null;
}

function devSearchProject(project: string, query: string): PromptSummary[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const summaries = devScanProject(project);
  if (!tokens.length) return summaries.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
  const matches = summaries.flatMap((summary) => {
    const snippet = devPrompts(project).find((item) => item.name === summary.name);
    if (!snippet) return [];
    const fields = [
      { value: summary.name, weight: 100 },
      { value: summary.relativePath, weight: 95 },
      { value: summary.metadata.tags.join(' '), weight: 60 },
      { value: summary.metadata.description, weight: 45 },
      { value: summary.metadata.models.join(' '), weight: 35 },
      { value: snippet.content, weight: 20 },
    ];
    let score = 0;
    for (const token of tokens) {
      const hit = Math.max(...fields.filter((field) => field.value.toLowerCase().includes(token)).map((field) => field.weight), 0);
      if (!hit) return [];
      score += hit;
    }
    return [{ summary, score: score / tokens.length }];
  });
  return matches.sort((a, b) => b.score - a.score || a.summary.name.localeCompare(b.summary.name)).map((item) => item.summary);
}
