import type { Project, ScriptFolder } from '@common/models';

function findScriptPageName(folder: ScriptFolder, pageId: string): string | null {
  for (const c of folder.children) {
    if (c.type === 'page' && c.id === pageId) return c.name;
    if (c.type === 'folder') {
      const n = findScriptPageName(c as ScriptFolder, pageId);
      if (n) return n;
    }
  }
  return null;
}

/** Human-readable label for a script page id, storyboard scene id, or panel id. */
export function resolveProjectEntityLabel(project: Project, id: string): string {
  const pageName = findScriptPageName(project.rootScriptFolder, id);
  if (pageName) return pageName;

  const sorted = [...project.scenes].sort((a, b) => a.order - b.order);
  for (let i = 0; i < sorted.length; i++) {
    const sc = sorted[i]!;
    if (sc.id === id) return sc.name?.trim() || `Scene ${i + 1}`;
    const p = sc.panels.find((x) => x.id === id);
    if (p) {
      const sn = sc.name?.trim() || `Scene ${i + 1}`;
      const pn = p.name?.trim() || `Panel ${p.order}`;
      return `${sn} — ${pn}`;
    }
  }

  return 'Unknown';
}
