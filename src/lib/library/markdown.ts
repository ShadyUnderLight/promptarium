import { variableSpans } from '$lib/compose/variables';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (/^(https?:|mailto:|#)/i.test(href)) return escapeHtml(href);
  return null;
}

function protectVariables(source: string): { text: string; values: string[] } {
  const spans = variableSpans(source);
  const values = spans.map((span) => source.slice(span.start, span.end));
  let text = source;
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    text = text.slice(0, span.start) + '\u0001v' + index + '\u0001' + text.slice(span.end);
  }
  return { text, values };
}

function inline(source: string): string {
  const protectedText = protectVariables(source);
  let html = escapeHtml(protectedText.text);
  const code: string[] = [];
  const tick = String.fromCharCode(96);

  html = html.replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), (_, value: string) => {
    code.push(value);
    return '\u0001c' + (code.length - 1) + '\u0001';
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, href: string) => {
    const safe = safeHref(href);
    return safe ? '<a href="' + safe + '" target="_blank" rel="noreferrer">' + label + '</a>' : label;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/  \n/g, '<br>');

  html = html.replace(/\u0001c(\d+)\u0001/g, (_, index: string) => '<code>' + code[Number(index)] + '</code>');
  html = html.replace(/\u0001v(\d+)\u0001/g, (_, index: string) => {
    const value = protectedText.values[Number(index)] ?? '';
    return '<mark class="prompt-variable">' + escapeHtml(value) + '</mark>';
  });
  return html;
}

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(line: string): boolean {
  return (
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}~~~/.test(line) ||
    line.trimStart().startsWith(String.fromCharCode(96).repeat(3)) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^ {0,3}(?:[-+*]|\d+\.)\s+/.test(line) ||
    /^ {0,3}>\s?/.test(line)
  );
}

/** A small, safe Markdown renderer for the library preview. It covers the
 * prompt-authoring syntax without injecting raw user HTML. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    let marker: string | null = null;
    if (line.trimStart().startsWith(String.fromCharCode(96).repeat(3))) marker = String.fromCharCode(96).repeat(3);
    else if (line.trimStart().startsWith('~~~')) marker = '~~~';
    if (marker) {
      const language = line.trimStart().slice(marker.length).trim().split(/\s+/)[0] ?? '';
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        code.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      const className = language ? ' class="language-' + escapeHtml(language) + '"' : '';
      output.push('<pre><code' + className + '>' + escapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      output.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
      index++;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      output.push('<hr>');
      index++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index++;
      }
      output.push('<blockquote>' + inline(quote.join('\n')) + '</blockquote>');
      continue;
    }

    const list = line.match(/^(\s*)([-+*]|\d+\.)\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:[-+*]|\d+\.)\s+(.+)$/);
        if (!item) break;
        items.push('<li>' + inline(item[1]) + '</li>');
        index++;
      }
      const tag = ordered ? 'ol' : 'ul';
      output.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push('<tr>' + tableCells(lines[index]).map((cell) => '<td>' + inline(cell) + '</td>').join('') + '</tr>');
        index++;
      }
      output.push(
        '<table><thead><tr>' +
          headers.map((cell) => '<th>' + inline(cell) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.join('') +
          '</tbody></table>'
      );
      continue;
    }

    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      if (lines[index].includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) break;
      paragraph.push(lines[index]);
      index++;
    }
    output.push('<p>' + inline(paragraph.join('\n')) + '</p>');
  }

  return output.join('');
}
