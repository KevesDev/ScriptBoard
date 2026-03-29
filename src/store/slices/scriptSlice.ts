import type { StateCreator } from 'zustand';
import type { ProjectStoreState } from '../projectStore';
import type { ScriptPage, ScriptFolder, Project } from '@common/models';

export function firstScriptPageIdFromRoot(root: ScriptFolder): string | null {
  const walk = (folder: ScriptFolder): string | null => {
    for (const c of folder.children) {
      if (c.type === 'page') return c.id;
      const nested = walk(c as ScriptFolder);
      if (nested) return nested;
    }
    return null;
  };
  return walk(root);
}

export function firstScriptPageId(project: Project): string | null {
  return firstScriptPageIdFromRoot(project.rootScriptFolder);
}

export interface ScriptSlice {
  updateScriptPageContent: (pageId: string, contentBase64: string) => void;
  syncScenesFromContent: (contentBase64: string) => void;
  importScriptPage: (fileName: string, content: string) => void;
  addPageToFolder: (folderId: string, pageName: string) => void;
  removeNode: (nodeId: string) => void;
  updateNodeName: (nodeId: string, name: string) => void;
}

export const createScriptSlice: StateCreator<ProjectStoreState, [], [], ScriptSlice> = (set) => ({
  updateScriptPageContent: (pageId, contentBase64) =>
    set((state) => {
      if (!state.project) return state;

      if (!contentBase64 || contentBase64.trim() === '') {
         contentBase64 = '<p></p>';
      }

      const updatePageInFolder = (folder: any): any => {
        return {
          ...folder,
          children: folder.children.map((child: any) => {
            if (child.type === 'page' && child.id === pageId) {
              return { ...child, contentBase64 };
            } else if (child.type === 'folder') {
              return updatePageInFolder(child);
            }
            return child;
          })
        };
      };

      return {
        project: {
          ...state.project,
          rootScriptFolder: updatePageInFolder(state.project.rootScriptFolder)
        }
      };
    }),

  syncScenesFromContent: (contentBase64) =>
    set((state) => {
      if (!state.project) return state;

      const parser = new DOMParser();
      const doc = parser.parseFromString(contentBase64, 'text/html');
      
      const sceneHeadingNodes = Array.from(doc.querySelectorAll('.scene-heading')).map(el => el.textContent?.trim()).filter(Boolean) as string[];

      let updatedScenes = [...state.project.scenes];
      let maxOrder = updatedScenes.length > 0 ? Math.max(...updatedScenes.map(s => s.order)) : 0;

      const currentValidHeadings = new Set<string>();

      sceneHeadingNodes.forEach(headingName => {
        if (!headingName || headingName.length < 3) return; 
        
        currentValidHeadings.add(headingName);
        
        if (!updatedScenes.some(s => s.name === headingName)) {
          updatedScenes.push({
            id: crypto.randomUUID(),
            name: headingName,
            order: ++maxOrder,
            panels: []
          });
        }
      });
      
      updatedScenes = updatedScenes.filter(scene => {
         return currentValidHeadings.has(scene.name) || scene.panels.length > 0;
      });

      return {
        project: {
          ...state.project,
          scenes: updatedScenes,
        }
      };
    }),

  importScriptPage: (fileName, content) =>
    set((state) => {
      if (!state.project) return state;

      let targetPageId: string | null = null;
      let targetFolderId: string | null = null;

      const findPage = (folder: any) => {
        for (const child of folder.children) {
          if (child.type === 'page' && child.name === fileName) {
            targetPageId = child.id;
            return true;
          } else if (child.type === 'folder') {
            if (findPage(child)) return true;
          }
        }
        return false;
      };
      findPage(state.project.rootScriptFolder);

      const lines = content.split(/\r?\n/);
      let htmlContent = '';
      for (let line of lines) {
        line = line.trim();
        if (!line) {
          htmlContent += '<p></p>';
          continue;
        }
        if (line.match(/^(INT\.|EXT\.|I\/E\.)\s/i)) {
          htmlContent += `<p class="scene-heading">${line}</p>`;
          
          if (!state.project.scenes.some(s => s.name === line)) {
            const maxOrder = state.project.scenes.length > 0 ? Math.max(...state.project.scenes.map(s => s.order)) : 0;
            state.project.scenes.push({
              id: crypto.randomUUID(),
              name: line,
              order: maxOrder + 1,
              panels: []
            });
          }
        } else if (line === line.toUpperCase() && line.length < 40 && !line.match(/^(INT\.|EXT\.|I\/E\.)\s/i) && !line.includes('  ')) {
          htmlContent += `<p class="character">${line}</p>`;
        } else if (line.startsWith('(') && line.endsWith(')')) {
          htmlContent += `<p class="parenthetical">${line}</p>`;
        } else if (line.match(/^(CUT TO:|FADE IN:|FADE OUT:|DISSOLVE TO:)$/i)) {
          htmlContent += `<p class="transition">${line}</p>`;
        } else {
          htmlContent += `<p class="action">${line}</p>`;
        }
      }

      if (targetPageId) {
        const updatePageInFolder = (folder: any): any => ({
          ...folder,
          children: folder.children.map((child: any) => {
            if (child.type === 'page' && child.id === targetPageId) {
              return { ...child, contentBase64: htmlContent };
            } else if (child.type === 'folder') {
              return updatePageInFolder(child);
            }
            return child;
          })
        });
        
        return {
          project: { ...state.project, rootScriptFolder: updatePageInFolder(state.project.rootScriptFolder) },
          activeScriptPageId: targetPageId
        };
      } else {
        const draftsFolder = state.project.rootScriptFolder.children.find(c => c.type === 'folder' && c.name === 'Drafts');
        targetFolderId = draftsFolder ? draftsFolder.id : state.project.rootScriptFolder.id;
        
        const newPage: ScriptPage = {
          id: crypto.randomUUID(),
          name: fileName,
          type: 'page',
          contentBase64: htmlContent
        };

        const addPage = (folder: any): any => {
          if (folder.id === targetFolderId) {
            return { ...folder, children: [...folder.children, newPage] };
          }
          return {
            ...folder,
            children: folder.children.map((child: any) => 
              child.type === 'folder' ? addPage(child) : child
            )
          };
        };

        return {
          project: { ...state.project, rootScriptFolder: addPage(state.project.rootScriptFolder) },
          activeScriptPageId: newPage.id
        };
      }
    }),

  addPageToFolder: (folderId, pageName) =>
    set((state) => {
      if (!state.project) return state;

      const newPage: ScriptPage = {
        id: crypto.randomUUID(),
        name: pageName,
        type: 'page',
        contentBase64: '' 
      };

      const addPage = (folder: any): any => {
        if (folder.id === folderId) {
          return { ...folder, children: [...folder.children, newPage] };
        }
        return {
          ...folder,
          children: folder.children.map((child: any) => 
            child.type === 'folder' ? addPage(child) : child
          )
        };
      };

      return {
        project: {
          ...state.project,
          rootScriptFolder: addPage(state.project.rootScriptFolder)
        },
        activeScriptPageId: newPage.id
      };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      if (!state.project) return state;

      const remove = (folder: any): any => {
        return {
          ...folder,
          children: folder.children
            .filter((child: any) => child.id !== nodeId)
            .map((child: any) => (child.type === 'folder' ? remove(child) : child)),
        };
      };

      const newRoot = remove(state.project.rootScriptFolder);
      let nextActive = state.activeScriptPageId;
      if (nextActive === nodeId) {
        nextActive = firstScriptPageIdFromRoot(newRoot);
      }

      return {
        project: {
          ...state.project,
          rootScriptFolder: newRoot,
        },
        activeScriptPageId: nextActive,
      };
    }),

  updateNodeName: (nodeId, name) =>
    set((state) => {
      if (!state.project) return state;

      const update = (folder: any): any => {
        return {
          ...folder,
          children: folder.children.map((child: any) => {
            if (child.id === nodeId) {
              return { ...child, name };
            } else if (child.type === 'folder') {
              return update(child);
            }
            return child;
          })
        };
      };

      return {
        project: {
          ...state.project,
          rootScriptFolder: update(state.project.rootScriptFolder)
        }
      };
    }),
});