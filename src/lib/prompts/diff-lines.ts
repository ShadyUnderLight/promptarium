export type DiffLineKind = 'add' | 'remove' | 'context' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export function parseDiffLines(patch: string): DiffLine[] {
  if (!patch.trim()) return [];
  return patch.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      return { kind: 'meta' as const, text: line };
    }
    if (line.startsWith('+')) return { kind: 'add' as const, text: line };
    if (line.startsWith('-')) return { kind: 'remove' as const, text: line };
    if (line.startsWith('@@')) return { kind: 'meta' as const, text: line };
    return { kind: 'context' as const, text: line };
  });
}
