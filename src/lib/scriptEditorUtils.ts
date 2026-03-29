import { base64ToUtf8Text } from './scriptContentBase64';

export const US_LETTER_PAGE_CSS_PX = 96 * 11;

export function printPageMarkerCenters(totalHeightPx: number): { num: number; top: number }[] {
  const h = Math.max(0, totalHeightPx);
  const n = Math.max(1, Math.ceil(h / US_LETTER_PAGE_CSS_PX));
  const markers: { num: number; top: number }[] = [];
  for (let i = 0; i < n; i++) {
    const bandTop = i * US_LETTER_PAGE_CSS_PX;
    const bandBottom = Math.min((i + 1) * US_LETTER_PAGE_CSS_PX, h);
    markers.push({ num: i + 1, top: (bandTop + bandBottom) / 2 });
  }
  return markers;
}

export function gutterMarkersFromPaper(paperEl: HTMLElement): { num: number; top: number }[] {
  const sh = paperEl.scrollHeight;
  const breaks = [...paperEl.querySelectorAll('.script-page-break-decorator')] as HTMLElement[];
  
  if (breaks.length === 0) {
    return printPageMarkerCenters(sh);
  }
  
  const midY = (el: HTMLElement) => {
    const pr = paperEl.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return er.top + er.height / 2 - pr.top;
  };
  const mids = breaks.map(midY);
  const out: { num: number; top: number }[] = [];
  
  // The first band is always Page 1
  out.push({ num: 1, top: Math.max(mids[0] / 2, 16) });
  
  // Explicitly read the True Page number from the Decorator we injected.
  // This allows the gutter to visually jump from Page 2 to Page 6 seamlessly.
  for (let i = 0; i < breaks.length - 1; i++) {
    const pageNum = parseInt(breaks[i].getAttribute('data-page-start') || String(i + 2), 10);
    out.push({ num: pageNum, top: (mids[i] + mids[i + 1]) / 2 });
  }
  
  const lastBreak = breaks[breaks.length - 1];
  const lastPageNum = parseInt(lastBreak.getAttribute('data-page-start') || String(breaks.length + 1), 10);
  out.push({ num: lastPageNum, top: (mids[mids.length - 1] + sh) / 2 });
  
  return out;
}

export function getSceneTitlesFromStoredContent(contentBase64: string): string[] {
  const titles: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === 'sceneHeading') {
      let t = '';
      (node.content || []).forEach((c: any) => {
        if (c.type === 'text') t += c.text || '';
      });
      titles.push(t.trim() || 'Scene');
    }
    (node.content || []).forEach(walk);
  };
  try {
    const raw = (contentBase64 || '').trim();
    if (!raw) return titles;
    const decoded = base64ToUtf8Text(raw);
    const json = JSON.parse(decoded);
    walk(json);
  } catch {
    /* ignore */
  }
  return titles;
}

export function findSceneHeadingDocumentPos(editor: { state: { doc: any } }, sceneIndex: number): number | null {
  let i = 0;
  let foundPos: number | null = null;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'sceneHeading') {
      if (i === sceneIndex) {
        foundPos = pos;
        return false;
      }
      i += 1;
    }
  });
  return foundPos;
}

export function applyCommentAttrsById(editor: any, commentId: string, attrs: { text?: string; author?: string; timestamp?: number }) {
  const markType = editor.state.schema.marks.comment;
  if (!markType) return;
  let from = -1;
  let to = -1;
  let prev: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const m = node.marks.find((mk: any) => mk.type === markType && mk.attrs.commentId === commentId);
    if (m) {
      if (from < 0) {
        from = pos;
        prev = { ...m.attrs };
      }
      to = pos + node.text.length;
    }
  });
  if (from < 0 || !prev) return;
  const next = { ...(prev as Record<string, unknown>), ...attrs, commentId };
  const tr = editor.state.tr.removeMark(from, to, markType).addMark(from, to, markType.create(next as any));
  editor.view.dispatch(tr);
}