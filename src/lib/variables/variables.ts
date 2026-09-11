/**
 * Prompt 变量语法与填充后的纯文本渲染。这里是唯一实现；Rust 不参与 body
 * 变量解析，避免前后端维护两套 grammar。原有 Rust half (`prompts/grammar.rs`)
 * 已删除，因为
 * after the schema cut nothing in the backend parses variables. There is no
 * second implementation to drift from, and so no cross-language vector table to
 * keep in sync; the vectors live in tests/prompts_smoke.mjs, one copy.
 *
 * That also means there is no safety net: nothing else will catch a mistake in
 * here.
 *
 * ── The grammar, in one sentence ─────────────────────────────────────────────
 *
 * **A snippet body is a Python format string.** If Python would parse it as a
 * replacement field, it is a variable; if not, it is literal text. That is the
 * whole rule, and it is deliberately a rule the user already knows.
 *
 *   1. `{name}` is a variable, where name is [A-Za-z0-9_-]+ (case-sensitive).
 *   2. `{{` 与 `}}` 是转义语法，不会生成变量 source span。
 *   3. Anything else braced is literal, because Python could not read it as a
 *      plain field either: `{my var}`, `{a.b}`, `{:x}`, `{"json": 1}`,
 *      `{ return x }`, and `{task:write tests}` (the removed default form) all
 *      simply fail rule 1's name test. This is not a list of exceptions — it is
 *      rule 1, seen from the other side. Degrading the removed default form to
 *      VISIBLE literal text is the point: the user sees the stray text and fixes
 *      it, where a silent reinterpretation would quietly swallow what they wrote.
 *   4. One name = one variable, document-wide. First-appearance order; repeats
 *      dedupe. The model cannot tell two identically-named variables apart, so
 *      pretending they differ would be a fiction the UI maintains and the output
 *      discards.
 *   5. 填充变量时直接使用对应字符串，缺失值和空值都输出空字符串。
 *   6. `renderFilledPrompt` 只替换变量 source span，不使用 normalized literal
 *      token 重建文本。
 *
 * ── There is no Markdown awareness. Do not add any. ──────────────────────────
 *
 * The grammar is UNIFORM over the whole document. It does not know what a code
 * fence is, or a backtick. A `{name}` inside ```-fenced code IS a variable.
 *
 * An earlier draft excluded fenced blocks and inline code spans, to stop a code
 * sample's braces from parsing. It was cut on purpose. "Variables work
 * everywhere, except inside backticks, and except inside fences" is a rule you
 * have to be TOLD — and being unguessable without having read a contract is the
 * exact disease this round exists to cure. "It's a Python format string" is a
 * rule the user already knows, and so does every LLM reading the output. Less to
 * remember beats more-correct-in-a-corner. We do not invent protocols.
 *
 * The cost is accepted knowingly, and it is LOUD rather than silent: a fenced
 * code sample containing `{name}` does become a variable — and the user SEES it,
 * because the chip renders the variable names it contains and the fill list lists
 * them. A stray `name` appears, and they escape it as `{{name}}`, exactly as they
 * would in Python. The UI surfacing every parsed variable is what makes this
 * safe.
 *
 * 转义花括号属于非变量源码，renderFilledPrompt 会逐字保留它们。需要替换
 * 的只有 scanner 返回的变量 source span，不会因为同一段 body 中出现其他
 * 变量而改变这些字面量。
 */

/** 一个去重后的变量名。变量值不属于 Prompt 文档本身。 */
export interface Variable {
  name: string;
}

/** 扫描得到的 token；literal token 仅用于解析，渲染会改用原始 source slice。 */
type Token =
  | { kind: 'literal'; text: string }
  | { kind: 'variable'; name: string; start: number; end: number };

/** 判断当前位置是否是合法变量。 */
const VAR_AT = /^\{([A-Za-z0-9_-]+)\}/;

/** 从左到右扫描全文，不感知 Markdown 结构。 */
function scan(text: string): Token[] {
  const tokens: Token[] = [];
  let literal = '';
  const flush = (): void => {
    if (literal) {
      tokens.push({ kind: 'literal', text: literal });
      literal = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{' || pair === '}}') {
      literal += text[i]; // `{{` → `{`, `}}` → `}` (an escape consumes both chars)
      i += 2;
      continue;
    }

    if (text[i] === '{') {
      const m = VAR_AT.exec(text.slice(i));
      if (m) {
        flush();
        tokens.push({ kind: 'variable', name: m[1], start: i, end: i + m[0].length });
        i += m[0].length;
        continue;
      }
    }

    literal += text[i];
    i++;
  }
  flush();
  return tokens;
}

/** 按首次出现顺序返回去重后的变量。 */
export function parseVariables(text: string): Variable[] {
  const seen = new Set<string>();
  const vars: Variable[] = [];
  for (const t of scan(text)) {
    if (t.kind === 'variable' && !seen.has(t.name)) {
      seen.add(t.name);
      vars.push({ name: t.name });
    }
  }
  return vars;
}

/** 返回预览高亮使用的变量源码区间。 */
export function variableSpans(text: string): Array<{ start: number; end: number; name: string }> {
  return scan(text).flatMap((token) =>
    token.kind === 'variable' ? [{ start: token.start, end: token.end, name: token.name }] : []
  );
}

/** 读取一次填充值，缺失值和 undefined 都按空字符串处理。 */
function resolve(name: string, fills: Record<string, string>): string {
  return Object.hasOwn(fills, name) ? (fills[name] ?? '') : '';
}

/**
 * 只替换 scanner 识别出的变量 source span，其他源码逐字保留。
 *
 * 因此 `{{repo}}` 在复制时仍是 `{{repo}}`；如果 body 同时含有 `{goal}`，
 * 填写 goal 也不会改变前者。填充值不会再次参与解析或转义。
 */
export function renderFilledPrompt(text: string, fills: Record<string, string>): string {
  const spans = variableSpans(text);
  if (!spans.length) return text;

  const out: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    out.push(text.slice(cursor, span.start));
    out.push(resolve(span.name, fills));
    cursor = span.end;
  }
  out.push(text.slice(cursor));
  return out.join('');
}
