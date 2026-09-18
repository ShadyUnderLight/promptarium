/**
 * Issue #64 — Real promptBodyExcerpt → PromptListItem path (no library mock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import PromptListItem from '../src/lib/components/library/PromptListItem.svelte';
import { library, promptBodyExcerpt } from '../src/lib/library.svelte';
import type { PromptDocument, PromptSummary } from '../src/lib/prompts/types';
import { setPreference } from '../src/lib/i18n/i18n.svelte';

vi.mock('$lib/api', () => ({
  isTauri: vi.fn(() => false),
}));

function summary(overrides: Partial<PromptSummary> = {}): PromptSummary {
  return {
    projectPath: '/proj',
    relativePath: 'code.md',
    name: 'code',
    folder: '',
    extension: '.md',
    metadata: {
      description: '',
      tags: [],
      status: 'active',
      favorite: false,
      models: [],
      related: [],
      extra: {},
    },
    modifiedAt: 0,
    hasFrontmatter: false,
    ...overrides,
  };
}

function documentFixture(body: string): PromptDocument {
  return {
    ...summary(),
    body,
    raw: body,
  };
}

beforeEach(() => {
  setPreference('en');
  library.selected = null;
  library.selectedProjectPath = null;
  library.selectedName = null;
  library.searchIndexVersion = 0;
});

afterEach(() => {
  cleanup();
  library.selected = null;
});

describe('promptBodyExcerpt integration (Issue #64)', () => {
  it('derives a fenced-code excerpt for the selected document fallback', () => {
    const prompt = summary();
    const body = '```ts\nconst value = 42;\n```';
    library.selected = documentFixture(body);
    library.selectedProjectPath = prompt.projectPath;
    library.selectedName = prompt.name;

    expect(promptBodyExcerpt(prompt)).toBe('const value = 42;');
  });

  it('renders the real excerpt in PromptListItem when description is empty', () => {
    const prompt = summary();
    const body = '```ts\nconst value = 42;\n```';
    library.selected = documentFixture(body);
    library.selectedProjectPath = prompt.projectPath;
    library.selectedName = prompt.name;

    const { container } = render(PromptListItem, {
      props: {
        prompt,
        selected: false,
        checked: false,
        variableCount: null,
        onSelect: () => {},
        onToggle: () => {},
      },
    });

    const description = container.querySelector('.prompt-list-item__description');
    expect(description?.textContent).toBe('const value = 42;');
    expect(description?.classList.contains('prompt-list-item__description--excerpt')).toBe(true);
    expect(container.textContent).not.toContain('No description yet');
  });
});
