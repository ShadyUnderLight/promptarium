import type { DeepSeekReasoningEffort } from '$lib/api';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export const DEFAULT_DEEPSEEK_REASONING_EFFORT: DeepSeekReasoningEffort = 'none';

const MODEL_STORAGE_KEY = 'promptarium-deepseek-model';
const REASONING_STORAGE_KEY = 'promptarium-deepseek-reasoning-effort';

function validModel(value: string | null): value is string {
  return Boolean(value && value.trim() && value.length <= 128 && !/[\u0000-\u0020]/.test(value));
}

export function readDeepSeekModel(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_DEEPSEEK_MODEL;
  const stored = localStorage.getItem(MODEL_STORAGE_KEY);
  return validModel(stored) ? stored : DEFAULT_DEEPSEEK_MODEL;
}

export function saveDeepSeekModel(model: string): void {
  if (!validModel(model) || typeof localStorage === 'undefined') return;
  localStorage.setItem(MODEL_STORAGE_KEY, model);
}

export function readDeepSeekReasoningEffort(): DeepSeekReasoningEffort {
  if (typeof localStorage === 'undefined') return DEFAULT_DEEPSEEK_REASONING_EFFORT;
  const stored = localStorage.getItem(REASONING_STORAGE_KEY);
  return stored === 'none' || stored === 'low' || stored === 'high' || stored === 'max'
    ? stored
    : DEFAULT_DEEPSEEK_REASONING_EFFORT;
}

export function saveDeepSeekReasoningEffort(effort: DeepSeekReasoningEffort): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(REASONING_STORAGE_KEY, effort);
}
