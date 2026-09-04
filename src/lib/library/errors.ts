/**
 * Machine-readable error seam (Issue #35 P0).
 *
 * Rust returns errors as `Err(String)`. Errors that carry a stable `CODE:`
 * prefix (the same convention `PROMPT_CONFLICT` already used) are parsed into
 * a machine code + a human `detail`. Business branches (navigation, missing
 * project UI, conditional rendering, recovery) must read `code`, never an
 * English substring of the message. The raw message may keep flowing to the
 * user as diagnostic detail.
 */

export type ErrorCode = 'PROJECT_FOLDER_NOT_FOUND' | 'PROMPT_FILE_NOT_FOUND' | 'PROMPT_CONFLICT';

const ERROR_CODE_PATTERN = /^(PROJECT_FOLDER_NOT_FOUND|PROMPT_FILE_NOT_FOUND|PROMPT_CONFLICT):\s*(.*)$/s;

export interface ParsedError {
  code: ErrorCode | null;
  /** Message without the code prefix — safe to show to the user. */
  detail: string;
}

/** Split an arbitrary thrown value into `{ code, detail }`. */
export function parseError(error: unknown): ParsedError {
  const raw = error instanceof Error ? error.message : String(error);
  const match = ERROR_CODE_PATTERN.exec(raw);
  if (match) return { code: match[1] as ErrorCode, detail: match[2] };
  return { code: null, detail: raw };
}

/** Human-safe message for user-facing display (toasts, banners) — strips any
 *  machine code prefix. All user-visible error text should go through this
 *  seam rather than `error.message`, so a coded backend error never leaks its
 *  prefix to the user. */
export function errorDetail(error: unknown): string {
  return parseError(error).detail;
}

/** True for the "something that used to exist is gone" family. */
export function isNotFoundError(code: ErrorCode | null): boolean {
  return code === 'PROJECT_FOLDER_NOT_FOUND' || code === 'PROMPT_FILE_NOT_FOUND';
}
