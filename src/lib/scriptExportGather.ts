import type { Project, ScriptFolder, ScriptPage } from '@common/models';
import { base64ToUtf8Text } from './scriptContentBase64';

function isPage(x: ScriptFolder | ScriptPage): x is ScriptPage {
  return x.type === 'page';
}

function walkPages(folder: ScriptFolder, out: ScriptPage[]) {
  for (const ch of folder.children) {
    if (isPage(ch)) out.push(ch);
    else walkPages(ch, out);
  }
}

export function collectScriptPagesInOrder(project: Project): ScriptPage[] {
  const root = project.rootScriptFolder;
  const pages: ScriptPage[] = [];
  walkPages(root, pages);
  return pages;
}

export function htmlToPlainText(html: string): string {
  const trimmed = (html || '').trim();
  if (!trimmed) return '';
  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/html');
    return (doc.body?.innerText || '').replace(/\r\n/g, '\n').trim();
  } catch {
    return trimmed;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type ParsedPageContent =
  | { kind: 'tiptap'; doc: { type: string; content?: unknown[] } }
  | { kind: 'html'; html: string };

/**
 * Script pages store `contentBase64`: base64(JSON) TipTap doc, or legacy base64(HTML) / raw HTML.
 */
function parseStoredScriptPageContent(
  contentBase64: string | undefined | null,
): ParsedPageContent | null {
  const raw = (contentBase64 || '').trim();
  if (!raw) return null;
  try {
    const decoded = base64ToUtf8Text(raw);
    if (decoded === '' && raw.length > 0) {
      return { kind: 'html', html: raw };
    }
    try {
      const doc = JSON.parse(decoded) as { type?: string };
      if (doc && typeof doc === 'object' && doc.type === 'doc') {
        return { kind: 'tiptap', doc: doc as { type: string; content?: unknown[] } };
      }
    } catch {
      /* not JSON */
    }
    return { kind: 'html', html: decoded };
  } catch {
    if (raw.startsWith('<')) return { kind: 'html', html: raw };
    return { kind: 'html', html: raw };
  }
}

function inlineToPlain(nodes: unknown[] | undefined): string {
  let s = '';
  for (const n of nodes || []) {
    const node = n as { type?: string; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
    if (node.type === 'text') {
      let t = node.text || '';
      for (const m of node.marks || []) {
        if (m.type === 'bold') t = `**${t}**`;
        else if (m.type === 'italic') t = `*${t}*`;
        else if (m.type === 'code') t = `\`${t}\``;
        else if (m.type === 'link') t = `${t} (${(m.attrs?.href as string) || ''})`;
        else if (m.type === 'comment') {
          const ct = String(m.attrs?.text || '').trim();
          if (ct) t = `${t} [${String(m.attrs?.author || 'note')}: ${ct}]`;
        }
      }
      s += t;
    } else if (node.type === 'hardBreak') {
      s += '\n';
    }
  }
  return s;
}

function inlineToHtml(nodes: unknown[] | undefined): string {
  let s = '';
  for (const n of nodes || []) {
    const node = n as { type?: string; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
    if (node.type === 'text') {
      let t = escapeHtml(node.text || '');
      for (const m of node.marks || []) {
        if (m.type === 'bold') t = `<strong>${t}</strong>`;
        else if (m.type === 'italic') t = `<em>${t}</em>`;
        else if (m.type === 'code') t = `<code>${t}</code>`;
        else if (m.type === 'link') {
          const href = escapeHtml(String(m.attrs?.href || '#'));
          t = `<a href="${href}">${t}</a>`;
        } else if (m.type === 'comment') {
          const title = escapeHtml(
            `${String(m.attrs?.author || '')}: ${String(m.attrs?.text || '')}`.trim(),
          );
          t = `<span class="script-comment" title="${title}">${t}</span>`;
        }
      }
      s += t;
    } else if (node.type === 'hardBreak') {
      s += '<br/>';
    }
  }
  return s;
}

function serializeBlockPlain(node: unknown): string {
  const n = node as {
    type?: string;
    content?: unknown[];
    attrs?: { level?: number; language?: string };
  };
  if (!n?.type) return '';
  const t = n.type;

  if (t === 'sceneHeading') return `${inlineToPlain(n.content as unknown[]).trim()}\n\n`;
  if (t === 'action') return `${inlineToPlain(n.content as unknown[]).trim()}\n\n`;
  if (t === 'character') return `${inlineToPlain(n.content as unknown[]).trim().toUpperCase()}\n`;
  if (t === 'dialogue') return `    ${inlineToPlain(n.content as unknown[]).trim()}\n`;
  if (t === 'parenthetical') {
    let p = inlineToPlain(n.content as unknown[]).trim();
    if (p && !p.startsWith('(')) p = `(${p}`;
    if (p && !p.endsWith(')')) p = `${p})`;
    return `    ${p}\n`;
  }
  if (t === 'transition') return `${inlineToPlain(n.content as unknown[]).trim().toUpperCase()}\n\n`;

  if (t === 'paragraph') return `${inlineToPlain(n.content as unknown[]).trim()}\n\n`;
  if (t === 'heading') {
    const level = Math.min(6, Math.max(1, n.attrs?.level ?? 1));
    const hashes = '#'.repeat(level);
    return `${hashes} ${inlineToPlain(n.content as unknown[]).trim()}\n\n`;
  }
  if (t === 'bulletList' || t === 'orderedList') {
    const items = (n.content || []) as unknown[];
    const lines = items.map((li, idx) => {
      const item = li as { content?: unknown[] };
      const body = (item.content || []).map(serializeBlockPlain).join('').trim();
      const prefix = t === 'bulletList' ? '- ' : `${idx + 1}. `;
      return `${prefix}${body.replace(/\n/g, '\n  ')}`;
    });
    return `${lines.join('\n')}\n\n`;
  }
  if (t === 'listItem') {
    return (n.content || []).map(serializeBlockPlain).join('');
  }
  if (t === 'codeBlock') {
    const lines: string[] = [];
    (n.content || []).forEach((child) => {
      const c = child as { type?: string; text?: string };
      if (c.type === 'text') lines.push(c.text || '');
    });
    return `\`\`\`${n.attrs?.language || ''}\n${lines.join('')}\n\`\`\`\n\n`;
  }
  if (t === 'blockquote') {
    const inner = (n.content || []).map(serializeBlockPlain).join('').trim();
    return inner
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
      .concat('\n\n');
  }
  if (t === 'horizontalRule') return '---\n\n';

  if (n.content && Array.isArray(n.content)) {
    return (n.content as unknown[]).map(serializeBlockPlain).join('');
  }
  return '';
}

function serializeBlockHtml(node: unknown): string {
  const n = node as {
    type?: string;
    content?: unknown[];
    attrs?: { level?: number; language?: string };
  };
  if (!n?.type) return '';
  const t = n.type;
  const innerPlain = inlineToHtml(n.content as unknown[]);

  if (t === 'sceneHeading') {
    return `<p class="scene-heading" data-type="sceneHeading">${innerPlain}</p>\n`;
  }
  if (t === 'action') {
    return `<p class="action" data-type="action">${innerPlain}</p>\n`;
  }
  if (t === 'character') {
    return `<p class="character" data-type="character">${innerPlain}</p>\n`;
  }
  if (t === 'dialogue') {
    return `<p class="dialogue" data-type="dialogue">${innerPlain}</p>\n`;
  }
  if (t === 'parenthetical') {
    return `<p class="parenthetical" data-type="parenthetical">${innerPlain}</p>\n`;
  }
  if (t === 'transition') {
    return `<p class="transition" data-type="transition">${innerPlain}</p>\n`;
  }

  if (t === 'paragraph') {
    return `<p>${innerPlain}</p>\n`;
  }
  if (t === 'heading') {
    const level = Math.min(6, Math.max(1, n.attrs?.level ?? 1));
    return `<h${level}>${innerPlain}</h${level}>\n`;
  }
  if (t === 'bulletList') {
    const items = (n.content || [])
      .map((li) => `<li>${serializeBlockHtml(li)}</li>\n`)
      .join('');
    return `<ul>\n${items}</ul>\n`;
  }
  if (t === 'orderedList') {
    const items = (n.content || [])
      .map((li) => `<li>${serializeBlockHtml(li)}</li>\n`)
      .join('');
    return `<ol>\n${items}</ol>\n`;
  }
  if (t === 'listItem') {
    return (n.content || []).map(serializeBlockHtml).join('');
  }
  if (t === 'codeBlock') {
    const lines: string[] = [];
    (n.content || []).forEach((child) => {
      const c = child as { type?: string; text?: string };
      if (c.type === 'text') lines.push(escapeHtml(c.text || ''));
    });
    const lang = escapeHtml(n.attrs?.language || '');
    return `<pre><code class="language-${lang}">${lines.join('')}</code></pre>\n`;
  }
  if (t === 'blockquote') {
    const inner = (n.content || []).map(serializeBlockHtml).join('');
    return `<blockquote>\n${inner}</blockquote>\n`;
  }
  if (t === 'horizontalRule') {
    return '<hr/>\n';
  }

  if (n.content && Array.isArray(n.content)) {
    return (n.content as unknown[]).map(serializeBlockHtml).join('');
  }
  return '';
}

export function tipTapDocToPlainText(doc: { content?: unknown[] }): string {
  const parts = (doc.content || []).map(serializeBlockPlain);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function tipTapDocToScreenplayHtml(doc: { content?: unknown[] }): string {
  return (doc.content || []).map(serializeBlockHtml).join('');
}

function pageToPlainText(page: ScriptPage): string {
  const parsed = parseStoredScriptPageContent(page.contentBase64);
  if (!parsed) return '';
  if (parsed.kind === 'tiptap') return tipTapDocToPlainText(parsed.doc);
  return htmlToPlainText(parsed.html);
}

function pageToHtmlBody(page: ScriptPage): string {
  const parsed = parseStoredScriptPageContent(page.contentBase64);
  if (!parsed) return '<p><i>Empty</i></p>';
  if (parsed.kind === 'tiptap') {
    const body = tipTapDocToScreenplayHtml(parsed.doc);
    return body || '<p><i>Empty</i></p>';
  }
  const inner = parsed.html.trim();
  if (!inner) return '<p><i>Empty</i></p>';
  if (inner.startsWith('<')) return inner;
  return `<p>${escapeHtml(inner)}</p>`;
}

export function buildMergedScriptPlainText(project: Project): string {
  const pages = collectScriptPagesInOrder(project);
  const parts: string[] = [];
  for (const p of pages) {
    const body = pageToPlainText(p);
    if (body) parts.push(body);
  }
  return parts.join('\n\n');
}

export function buildScriptHtmlDocument(project: Project): string {
  const title = escapeHtml(project.name || 'Script');
  const style = `body { font-family: "Courier New", Courier, monospace; max-width: 720px; margin: 0 auto; padding: 40px 24px; line-height: 1.45; color: #111; }
    h1.script-page-title { font-size: 1.25rem; margin: 2rem 0 1rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h1.script-page-title:first-child { margin-top: 0; }
    .scene-heading { font-weight: bold; text-transform: uppercase; margin: 1.25rem 0 0.5rem; }
    .action { margin: 0.35rem 0; }
    .character { font-weight: bold; text-transform: uppercase; margin: 0.75rem 0 0; text-align: center; }
    .dialogue { margin: 0 10% 0 20%; }
    .parenthetical { margin: 0.15rem 0 0.15rem 25%; font-style: italic; }
    .transition { margin: 1rem 0; text-align: right; font-weight: bold; text-transform: uppercase; }
    hr.page-sep { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
    .script-comment { border-bottom: 1px dashed #ca8a04; }`;

  let htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title><style>${style}</style></head><body>`;

  const appendPages = (folder: ScriptFolder) => {
    folder.children.forEach((child) => {
      if (child.type === 'page') {
        htmlContent += `<h1 class="script-page-title">${escapeHtml(child.name)}</h1>\n`;
        htmlContent += pageToHtmlBody(child);
        htmlContent += '<hr class="page-sep"/>\n';
      } else {
        appendPages(child);
      }
    });
  };
  appendPages(project.rootScriptFolder);
  htmlContent += '</body></html>';
  return htmlContent;
}
