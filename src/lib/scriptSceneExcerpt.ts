import type { Project, ScriptFolder, ScriptPage } from '@common/models';
import { base64ToUtf8Text } from './scriptContentBase64';

export type ScriptSceneBlock = {
  type: string;
  text: string;
};

export type ParsedScriptScene = {
  heading: string;
  blocks: ScriptSceneBlock[];
};

function collectText(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (Array.isArray(node.content)) return node.content.map(collectText).join('');
  return '';
}

function parseDocToScenes(doc: any): ParsedScriptScene[] {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return [];
  const scenes: ParsedScriptScene[] = [];
  let cur: ParsedScriptScene | null = null;
  for (const block of doc.content) {
    const t = block?.type;
    if (t === 'sceneHeading') {
      if (cur) scenes.push(cur);
      cur = { heading: collectText(block).trim() || 'Scene', blocks: [] };
      continue;
    }
    if (!cur) continue;
    const text = collectText(block).trim();
    if (!text) continue;
    cur.blocks.push({ type: typeof t === 'string' ? t : 'block', text });
  }
  if (cur) scenes.push(cur);
  return scenes;
}

export function parseStoredScriptPageToScenes(contentBase64: string): ParsedScriptScene[] {
  try {
    const raw = (contentBase64 || '').trim();
    if (!raw) return [];
    const decoded = base64ToUtf8Text(raw);
    if (!decoded) return [];
    const json = JSON.parse(decoded);
    return parseDocToScenes(json);
  } catch {
    return [];
  }
}

function normalizeHeading(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function findSceneMatch(
  scenes: ParsedScriptScene[],
  storyboardSceneName: string,
  storyboardSceneOrderIndex: number,
): ParsedScriptScene | null {
  const norm = normalizeHeading(storyboardSceneName);
  const direct = scenes.find((s) => normalizeHeading(s.heading) === norm);
  if (direct) return direct;

  const m = storyboardSceneName.trim().match(/^Scene\s+(\d+)\s*$/i);
  if (m) {
    const idx = parseInt(m[1]!, 10) - 1;
    if (idx >= 0 && idx < scenes.length) return scenes[idx]!;
  }

  if (storyboardSceneOrderIndex >= 0 && storyboardSceneOrderIndex < scenes.length) {
    return scenes[storyboardSceneOrderIndex]!;
  }

  if (norm.length >= 4) {
    const fuzzy = scenes.find(
      (s) =>
        normalizeHeading(s.heading).includes(norm) || norm.includes(normalizeHeading(s.heading)),
    );
    if (fuzzy) return fuzzy;
  }

  return null;
}

function traversePages(folder: ScriptFolder, acc: ScriptPage[]): void {
  for (const c of folder.children) {
    if (c.type === 'page') acc.push(c as ScriptPage);
    else traversePages(c as ScriptFolder, acc);
  }
}

export function getAllScriptPages(project: Project): ScriptPage[] {
  const acc: ScriptPage[] = [];
  traversePages(project.rootScriptFolder, acc);
  return acc;
}

/** Script pages explicitly linked to this storyboard scene (or any of its panels). */
export function getLinkedScriptPageIdsForStoryboardScene(
  project: Project,
  sceneId: string,
  panelIds: string[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const l of project.links) {
    if (l.type !== 'page-to-scene') continue;
    if (l.targetId === sceneId || panelIds.includes(l.targetId)) {
      if (!seen.has(l.sourceId)) {
        seen.add(l.sourceId);
        ids.push(l.sourceId);
      }
    }
  }
  return ids;
}

export type SceneScriptContext = {
  sourcePageName: string;
  sourcePageId: string;
  heading: string;
  blocks: ScriptSceneBlock[];
};

export function getSceneScriptContext(
  project: Project,
  sceneName: string,
  sceneOrderIndex: number,
  sceneId: string,
  panelIds: string[],
): SceneScriptContext | null {
  const linkedIds = getLinkedScriptPageIdsForStoryboardScene(project, sceneId, panelIds);
  const allPages = getAllScriptPages(project);
  const orderedPages =
    linkedIds.length > 0
      ? linkedIds
          .map((id) => allPages.find((p) => p.id === id))
          .filter((p): p is ScriptPage => !!p)
      : allPages;

  for (const page of orderedPages) {
    const parsed = parseStoredScriptPageToScenes(page.contentBase64 || '');
    const hit = findSceneMatch(parsed, sceneName, sceneOrderIndex);
    if (hit) {
      return {
        sourcePageName: page.name,
        sourcePageId: page.id,
        heading: hit.heading,
        blocks: hit.blocks,
      };
    }
  }

  return null;
}

/** Limit blocks shown in the outliner (full data still available elsewhere). */
export function trimBlocksForDisplay(blocks: ScriptSceneBlock[], maxBlocks: number): ScriptSceneBlock[] {
  if (blocks.length <= maxBlocks) return blocks;
  return blocks.slice(0, maxBlocks);
}
