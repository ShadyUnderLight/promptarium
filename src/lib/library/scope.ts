/** Library browsing scope: one project or all registered projects. */
export type LibraryScope =
  | { kind: 'project'; projectPath: string }
  | { kind: 'all-projects' };

export interface PromptIdentity {
  projectPath: string;
  name: string;
}

export function promptKey(projectPath: string, name: string): string {
  return projectPath + '\u0000' + name;
}

export function identityFromSummary(summary: { projectPath: string; name: string }): PromptIdentity {
  return { projectPath: summary.projectPath, name: summary.name };
}

export function isAllProjectsScope(scope: LibraryScope): boolean {
  return scope.kind === 'all-projects';
}

export function isProjectScope(scope: LibraryScope, projectPath: string): boolean {
  return scope.kind === 'project' && scope.projectPath === projectPath;
}

export function scopeAllowsProject(scope: LibraryScope, projectPath: string, activeProjectPath: string | null): boolean {
  if (scope.kind === 'all-projects') return true;
  return activeProjectPath === projectPath;
}
