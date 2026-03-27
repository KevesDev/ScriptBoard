import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  User,
  MessageSquare,
  Parentheses,
  ChevronsRight,
  Clapperboard,
  Plus,
  X,
  MessageCircle,
} from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useAppStore } from '../store/appStore';
import type { ScriptFolder, ScriptPage } from '@common/models';
import { SceneHeading, Action, Character, Dialogue, Parenthetical, Transition, ScreenplayShortcuts, ScreenplayDefaultEnter, CommentMark } from '../tiptap/ScreenplayNodes';
import { ScreenplayTabCycle } from '../tiptap/ScreenplayTabCycle';
import { handleScreenplayAutoCapitalize, ScreenplaySentenceCapState } from '../lib/screenplayAutoCapitalize';
import {
  AFTER_NATIVE_DIALOG_EVENT,
  nativeConfirm,
  restoreElectronWindowKeyboardFocus,
  scheduleReturnFocusToProseMirror,
} from '../lib/focusAfterNativeDialog';
import { base64ToUtf8Text, utf8TextToBase64 } from '../lib/scriptContentBase64';

/** Scene titles in document order from stored TipTap JSON (for link picker on other pages). */
function getSceneTitlesFromStoredContent(contentBase64: string): string[] {
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

function findSceneHeadingDocumentPos(editor: { state: { doc: any } }, sceneIndex: number): number | null {
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

/** Update comment mark attrs by stable id without moving focus into the editor. */
function applyCommentAttrsById(editor: any, commentId: string, attrs: { text?: string; author?: string; timestamp?: number }) {
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

const MenuBar = ({
  editor,
  allPages,
  activeScriptPageId,
  outlineItems,
}: {
  editor: any;
  allPages: ScriptPage[];
  activeScriptPageId: string | null;
  outlineItems: { id: string; title: string; pos: number }[];
}) => {
  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-[#323232] border-b border-black text-[#9ca3af]">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('bold') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Bold"
      >
        <Bold size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('italic') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Italic"
      >
        <Italic size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('underline') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Underline"
      >
        <UnderlineIcon size={16} />
      </button>

      <div className="w-px h-5 bg-[#444] mx-1"></div>
      
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('bulletList') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Bullet List"
      >
        <List size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('orderedList') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Ordered List"
      >
        <ListOrdered size={16} />
      </button>

      <div className="w-px h-5 bg-[#444] mx-1"></div>

      <input
        type="color"
        onInput={event => editor.chain().focus().setColor((event.target as HTMLInputElement).value).run()}
        value={editor.getAttributes('textStyle').color || '#000000'}
        data-testid="setColor"
        className="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent"
        title="Text Color"
      />
      
      <div className="w-px h-5 bg-[#444] mx-1"></div>

      <button
        onClick={() => {
          if (editor.isActive('comment')) {
            editor.chain().focus().unsetMark('comment').run();
          } else {
            const authorName = useProjectStore.getState().project?.settings?.author || 'Unknown Author';
            editor.chain().focus().setMark('comment', {
              commentId: Date.now().toString(),
              text: 'New comment...',
              author: authorName,
              timestamp: Date.now()
            }).run();
          }
        }}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('comment') ? 'bg-[#444] text-[#eab308] shadow-inner' : ''}`}
        title="Add/Remove Comment"
      >
        <MessageCircle size={16} />
      </button>

      <div className="flex items-center gap-1 max-w-[min(420px,40vw)]">
        <div className={`p-1.5 rounded shrink-0 transition-colors ${editor.isActive('link') ? 'bg-[#444] text-white shadow-inner' : ''}`}>
          <LinkIcon size={16} />
        </div>
        <select 
          className="bg-[#151515] border border-[#444] text-xs px-2 py-1 rounded text-neutral-300 outline-none min-w-0 flex-1 truncate"
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'unlink') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
            } else if (val.startsWith('script-card:') || val.startsWith('script-page:')) {
              editor.chain().focus().extendMarkRange('link').setLink({ href: val }).run();
            }
            e.target.value = '';
          }}
          value=""
          title="Link selection to a scene card or document"
        >
          <option value="" disabled>Link to scene…</option>
          {editor.isActive('link') && <option value="unlink">- Remove link -</option>}
          {allPages.flatMap((p) => {
            const titles =
              p.id === activeScriptPageId && outlineItems.length > 0
                ? outlineItems.map((o) => o.title)
                : getSceneTitlesFromStoredContent(p.contentBase64 || '');
            if (titles.length === 0) {
              return (
                <option key={`doc-${p.id}`} value={`script-page:${p.id}`}>
                  {p.name} (document)
                </option>
              );
            }
            return titles.map((title, idx) => (
              <option key={`${p.id}-${idx}`} value={`script-card:${p.id}:${idx}`}>
                {p.name}: {title.length > 48 ? `${title.slice(0, 48)}…` : title}
              </option>
            ));
          })}
        </select>
      </div>
    </div>
  );
};

export const ScriptEditor: React.FC = () => {
  const { project, activeScriptPageId, setActiveScriptPageId, updateScriptPageContent, addPageToFolder, removeNode, updateNodeName, updateProjectSettings, updateProjectName } = useProjectStore();
  const { preferences } = useAppStore();
  
  const [activeRightTab, setActiveRightTab] = React.useState<'outline' | 'documents' | 'info' | 'notes' | 'comments'>('documents');
  const [editingTabId, setEditingTabId] = React.useState<string | null>(null);
  const [editingTabName, setEditingTabName] = React.useState('');
  const [activeCommentId, setActiveCommentId] = React.useState<string | null>(null);
  const [activeCommentData, setActiveCommentData] = React.useState<{id: string, text: string, author: string} | null>(null);

  const pendingCardNavRef = useRef<{ pageId: string; sceneIndex: number } | null>(null);
  const commentSidebarFocusRef = useRef(false);
  const commentSidebarBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [rightSidebarWidth, setRightSidebarWidth] = React.useState(() => {
    if (typeof window === 'undefined') return 320;
    const v = window.localStorage.getItem('scriptboard.scriptSidebarWidth');
    const n = v ? parseInt(v, 10) : 320;
    return Number.isFinite(n) ? Math.min(640, Math.max(200, n)) : 320;
  });
  const sidebarResizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const latestSidebarWidthRef = useRef(rightSidebarWidth);
  latestSidebarWidthRef.current = rightSidebarWidth;

  const onSidebarResizeMove = useCallback((e: PointerEvent) => {
    const drag = sidebarResizeRef.current;
    if (!drag) return;
    const delta = drag.startX - e.clientX;
    const next = Math.min(640, Math.max(200, drag.startW + delta));
    latestSidebarWidthRef.current = next;
    setRightSidebarWidth(next);
  }, []);

  const onSidebarResizeUp = useCallback(() => {
    sidebarResizeRef.current = null;
    window.removeEventListener('pointermove', onSidebarResizeMove);
    window.removeEventListener('pointerup', onSidebarResizeUp);
    window.localStorage.setItem('scriptboard.scriptSidebarWidth', String(latestSidebarWidthRef.current));
  }, [onSidebarResizeMove]);

  const beginSidebarResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      sidebarResizeRef.current = { startX: e.clientX, startW: rightSidebarWidth };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', onSidebarResizeMove);
      window.addEventListener('pointerup', onSidebarResizeUp);
    },
    [rightSidebarWidth, onSidebarResizeMove, onSidebarResizeUp]
  );

  const getAllPages = (): ScriptPage[] => {
    if (!project) return [];
    let pages: ScriptPage[] = [];
    const traverse = (folder: ScriptFolder) => {
      folder.children.forEach(c => {
        if (c.type === 'page') pages.push(c as ScriptPage);
        else traverse(c as ScriptFolder);
      });
    };
    traverse(project.rootScriptFolder);
    return pages;
  };
  const allPages = getAllPages();

  // Helper to find the active page content without binding to the reactive project dependency
  const loadContentForPage = (pageId: string): any => {
    const currentProject = useProjectStore.getState().project;
    if (!currentProject || !pageId) return '';
    
    let content = '';
    const findPage = (folder: ScriptFolder) => {
      for (const child of folder.children) {
        if (child.type === 'page' && child.id === pageId) {
          // Changed default new line to Action instead of SceneHeading
          content = child.contentBase64 || '<p class="action"></p>';
          return true;
        } else if (child.type === 'folder') {
          if (findPage(child as ScriptFolder)) return true;
        }
      }
      return false;
    };
    findPage(currentProject.rootScriptFolder);

    try {
      const decoded = base64ToUtf8Text(content);
      if (decoded === '' && content.trim() !== '') {
        return content;
      }
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    } catch {
      return content;
    }
  };

  const [outlineItems, setOutlineItems] = React.useState<{id: string, title: string, pos: number}[]>([]);

  const isUpdatingRef = useRef(false);
  /** True while applying `setContent` for a page switch; blocks onUpdate from persisting the wrong doc to the new page id. */
  const loadingPageContentRef = useRef(false);
  /** Page id whose document in the editor was last loaded from the store; null until first load completes. */
  const lastLoadedScriptPageIdRef = useRef<string | null>(null);
  /** When this differs from `project.id`, we must apply store content even if JSON matches (new project / load). */
  const lastSyncedProjectIdRef = useRef<string | null>(null);
  const editorRef = useRef<any>(null);
  const activeScriptPageIdRef = useRef<string | null>(activeScriptPageId);
  activeScriptPageIdRef.current = activeScriptPageId;
  const navigateInternalScriptHrefRef = useRef<(href: string) => void>(() => {});

  /** Stable identity so TipTap does not call `setOptions` every render (which can lock `editable: false` after `window.confirm`). */
  const scriptEditorProps = useMemo(
    () => ({
      attributes: {
        class: 'prose mx-auto focus:outline-none min-h-full text-black',
      },
      handleTextInput: (view: any, from: number, to: number, text: string) => {
        const cap =
          useAppStore.getState().preferences.scriptSettings?.autoCapitalizeFirstLetter !== false;
        if (!cap) return false;
        return handleScreenplayAutoCapitalize(view, from, to, text);
      },
      handleClickOn: (_view: unknown, _pos: number, node: any, _nodePos: number, _event: unknown, _direct: boolean) => {
        if (node.marks) {
          const linkMark = node.marks.find((m: any) => m.type.name === 'link');
          if (linkMark) {
            const href = linkMark.attrs.href as string;
            if (href?.startsWith('script-page:') || href?.startsWith('script-card:')) {
              navigateInternalScriptHrefRef.current(href);
              return true;
            }
          }
        }
        return false;
      },
    }),
    [preferences.scriptSettings?.autoCapitalizeFirstLetter],
  );

  const updateOutline = (editorInstance: any) => {
    if (!editorInstance) return;
    const items: {id: string, title: string, pos: number}[] = [];
    editorInstance.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'sceneHeading') {
        items.push({ id: pos.toString(), title: node.textContent || 'Empty Scene', pos });
      }
    });
    setOutlineItems(items);
  };

  const editor = useEditor(
    {
    extensions: [
      Action, // Action is first, so it becomes the default block node for the Document!
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Link.configure({
        openOnClick: false,
        protocols: [
          { scheme: 'script-card', optionalSlashes: false },
          { scheme: 'script-page', optionalSlashes: false },
        ],
        isAllowedUri: (url, ctx) => {
          if (typeof url === 'string' && (url.startsWith('script-card:') || url.startsWith('script-page:'))) {
            return true;
          }
          return ctx.defaultValidate(url);
        },
        HTMLAttributes: {
          class: 'text-[#4285f4] underline cursor-pointer script-internal-link',
          rel: 'noopener noreferrer',
        },
      }),
      ScreenplayShortcuts,
      ScreenplaySentenceCapState,
      SceneHeading,
      Character,
      Dialogue,
      Parenthetical,
      Transition,
      ScreenplayTabCycle,
      ScreenplayDefaultEnter,
      CommentMark,
    ],
    /** Shell only; page JSON/HTML is applied in the sync effect so `content` is not a new object every Zustand update. */
    content: '<p class="action"></p>',
    editable: true,
    editorProps: scriptEditorProps,
    onUpdate: ({ editor }) => {
      if (loadingPageContentRef.current) return;
      const pageId = activeScriptPageIdRef.current;
      if (!pageId) return;
      const synced = lastLoadedScriptPageIdRef.current;
      if (synced !== null && pageId !== synced) return;

      isUpdatingRef.current = true;
      try {
        const json = editor.getJSON();
        updateScriptPageContent(pageId, utf8TextToBase64(JSON.stringify(json)));
      } catch (err) {
        console.error('Failed to persist script page (e.g. encoding)', err);
      } finally {
        isUpdatingRef.current = false;
      }
      updateOutline(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      if (commentSidebarFocusRef.current) return;

      try {
        let foundComment = false;
        if (editor.isActive('comment')) {
          const a = editor.getAttributes('comment');
          if (a.commentId) {
            setActiveCommentId(a.commentId);
            setActiveCommentData({
              id: a.commentId,
              text: a.text ?? '',
              author: a.author ?? '',
            });
            setActiveRightTab('comments');
            foundComment = true;
          }
        }
        if (!foundComment) {
          const { state } = editor;
          const { $from, $to } = state.selection;
          const from = Math.min($from.pos, $to.pos);
          const to = Math.max($from.pos, $to.pos);
          state.doc.nodesBetween(from, to, (node) => {
            if (node.marks) {
              const commentMark = node.marks.find((m) => m.type.name === 'comment');
              if (commentMark) {
                setActiveCommentId(commentMark.attrs.commentId);
                setActiveCommentData({
                  id: commentMark.attrs.commentId,
                  text: commentMark.attrs.text,
                  author: commentMark.attrs.author,
                });
                setActiveRightTab('comments');
                foundComment = true;
                return false;
              }
            }
          });
        }

        if (!foundComment) {
          setActiveCommentId(null);
          setActiveCommentData(null);
        }
      } catch {
        /* selection/doc can be transiently invalid during page swaps */
      }
    },
    onBlur: () => {
      // Intentionally empty to prevent auto-syncing scenes
    },
  },
    // New project / load: fresh TipTap instance. Same project: keep instance so Zustand script edits do not recreate the editor.
    [project?.id ?? '__no_project__'],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    const fixEditable = () => {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const ed = editorRef.current;
            if (ed && !ed.isDestroyed) ed.setEditable(true);
          });
        });
      });
    };
    window.addEventListener(AFTER_NATIVE_DIALOG_EVENT, fixEditable);
    return () => window.removeEventListener(AFTER_NATIVE_DIALOG_EVENT, fixEditable);
  }, []);

  // Update editor content when active page or project identity changes
  useEffect(() => {
    if (!editor) return;

    const projectId = project?.id ?? null;
    const projectSwapped = lastSyncedProjectIdRef.current !== projectId;

    loadingPageContentRef.current = true;
    lastLoadedScriptPageIdRef.current = null;

    try {
      if (activeScriptPageId) {
        const content = loadContentForPage(activeScriptPageId);

        const currentJsonStr = JSON.stringify(editor.getJSON());
        const newJsonStr = typeof content === 'string' ? content : JSON.stringify(content);

        if (projectSwapped || currentJsonStr !== newJsonStr || editor.isEmpty) {
          const newContent = !content || content === '' ? '<p class="action"></p>' : content;
          try {
            editor.commands.setContent(newContent);
          } catch (err) {
            console.error('setContent failed, resetting to empty action line', err);
            editor.commands.setContent('<p class="action"></p>');
          }
        }
        updateOutline(editor);
        lastLoadedScriptPageIdRef.current = activeScriptPageId;
      } else {
        try {
          editor.commands.setContent('<p class="action"></p>');
        } catch (err) {
          console.error('setContent (no active page) failed', err);
        }
        updateOutline(editor);
      }
    } finally {
      loadingPageContentRef.current = false;
      lastSyncedProjectIdRef.current = projectId;
      if (editor && !editor.isDestroyed) {
        // TipTap's useEditor can call setOptions with `editable: editor.isEditable`; after `window.confirm`,
        // that can briefly be false and persist in options — ProseMirror then stays contenteditable=false.
        editor.setEditable(true);
      }
    }

    const pending = pendingCardNavRef.current;
    if (editor && activeScriptPageId && pending && pending.pageId === activeScriptPageId) {
      pendingCardNavRef.current = null;
      setTimeout(() => {
        try {
          const pos = findSceneHeadingDocumentPos(editor, pending.sceneIndex);
          if (pos != null) {
            editor.chain().setTextSelection(pos + 1).scrollIntoView().focus().run();
          }
        } catch {
          /* ignore */
        }
      }, 80);
      return;
    }

    if (editor && activeScriptPageId) {
      const runFocus = () => {
        if (commentSidebarFocusRef.current || loadingPageContentRef.current) return;
        editor.commands.focus();
        scheduleReturnFocusToProseMirror();
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(runFocus, 0);
        });
      });
    }
  }, [activeScriptPageId, editor, project?.id]); // `project.id` only — avoids reload loops on content edits

  navigateInternalScriptHrefRef.current = (href: string) => {
    if (!href) return;
    const ed = editorRef.current;
    if (href.startsWith('script-page:')) {
      const pageId = href.slice('script-page:'.length);
      useProjectStore.getState().setActiveScriptPageId(pageId);
      setTimeout(() => editorRef.current?.chain().focus().run(), 120);
      return;
    }
    const m = href.match(/^script-card:([^:]+):(\d+)$/);
    if (!m || !ed) return;
    const pageId = m[1];
    const sceneIndex = parseInt(m[2], 10);
    if (Number.isNaN(sceneIndex)) return;
    if (pageId === activeScriptPageIdRef.current) {
      const pos = findSceneHeadingDocumentPos(ed, sceneIndex);
      if (pos != null) {
        ed.chain().setTextSelection(pos + 1).scrollIntoView().focus().run();
      }
    } else {
      pendingCardNavRef.current = { pageId, sceneIndex };
      useProjectStore.getState().setActiveScriptPageId(pageId);
    }
  };

  const firstPageId = allPages[0]?.id;

  useEffect(() => {
    if (!project || activeScriptPageId != null || !firstPageId) return;
    setActiveScriptPageId(firstPageId);
  }, [project?.id, activeScriptPageId, firstPageId, setActiveScriptPageId]);

  if (!project) return <div className="p-4 text-neutral-500 bg-[#151515] h-full">No project loaded.</div>;

  const handleNewPage = () => {
     // Find the "Documents" folder or just root to add a page
     const docsFolder = project.rootScriptFolder.children.find(c => c.type === 'folder' && c.name === 'Documents');
     const targetId = docsFolder ? docsFolder.id : project.rootScriptFolder.id;
     addPageToFolder(targetId, `Script ${allPages.length + 1}`);
  };

  const handleDeleteScriptPage = async (page: ScriptPage) => {
    const ok = await nativeConfirm(`Delete script ${page.name}?`);
    if (ok) removeNode(page.id);
    window.setTimeout(() => {
      restoreElectronWindowKeyboardFocus();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scheduleReturnFocusToProseMirror();
          editorRef.current?.setEditable?.(true);
          editorRef.current?.commands.focus();
        });
      });
    }, ok ? 120 : 0);
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-neutral-200 overflow-hidden font-sans">
      {/* Document Tabs */}
      <div className="flex items-center bg-[#282828] border-b border-black overflow-x-auto shrink-0 select-none">
        {allPages.map(page => (
          <div 
            key={page.id} 
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setActiveScriptPageId(page.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingTabId(page.id);
              setEditingTabName(page.name);
            }}
            className={`px-4 py-2 text-[13px] font-medium cursor-pointer border-r border-black flex items-center gap-2 transition-colors ${activeScriptPageId === page.id ? 'bg-[#323232] text-white border-t-2 border-t-blue-500' : 'bg-[#282828] text-neutral-400 hover:bg-[#323232] border-t-2 border-t-transparent'}`}
          >
            {editingTabId === page.id ? (
              <input 
                autoFocus
                maxLength={30}
                value={editingTabName}
                onChange={e => setEditingTabName(e.target.value)}
                onBlur={() => {
                  if (editingTabName.trim() !== '') {
                    updateNodeName(page.id, editingTabName.trim());
                  }
                  setEditingTabId(null);
                }}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    if (editingTabName.trim() !== '') {
                      updateNodeName(page.id, editingTabName.trim());
                    }
                    setEditingTabId(null);
                  } else if (e.key === 'Escape') {
                    setEditingTabId(null);
                  }
                }}
                className="bg-[#151515] text-white px-1 outline-none w-24 rounded border border-blue-500"
                onClick={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
              />
            ) : (
              <span className="whitespace-nowrap select-none" onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingTabId(page.id);
                setEditingTabName(page.name);
              }}>{page.name}</span>
            )}
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                void handleDeleteScriptPage(page); 
              }} 
              className={`p-0.5 rounded hover:bg-black/30 hover:text-red-400 ${activeScriptPageId === page.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              title="Close/Delete Page"
            >
              <X size={14}/>
            </button>
          </div>
        ))}
        <button onClick={handleNewPage} className="p-2 ml-1 text-neutral-400 hover:text-white hover:bg-[#323232] rounded" title="New Script Document"><Plus size={16} /></button>
      </div>

      <MenuBar editor={editor} allPages={allPages} activeScriptPageId={activeScriptPageId} outlineItems={outlineItems} />
      
      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar - Line Types */}
        <div className="w-[72px] shrink-0 bg-[#323232] border-r border-black flex flex-col items-center py-4 gap-4 z-10 text-[#d1d5db]">
          <LineTypeButton editor={editor} type="sceneHeading" icon={<ImageIcon size={20} strokeWidth={1.5} />} title={`Scene (${(preferences.shortcuts.scriptScene || 'ctrl+1').toUpperCase()})`} label="Scene" />
          <LineTypeButton editor={editor} type="action" icon={<Clapperboard size={20} strokeWidth={1.5} />} title={`Action (${(preferences.shortcuts.scriptAction || 'ctrl+2').toUpperCase()})`} label="Action" />
          <LineTypeButton editor={editor} type="character" icon={<User size={20} strokeWidth={1.5} />} title={`Character (${(preferences.shortcuts.scriptCharacter || 'ctrl+3').toUpperCase()})`} label="Character" />
          <LineTypeButton editor={editor} type="parenthetical" icon={<Parentheses size={20} strokeWidth={1.5} />} title={`Parenthetical (${(preferences.shortcuts.scriptParenthetical || 'ctrl+4').toUpperCase()})`} label="Parens" />
          <LineTypeButton editor={editor} type="dialogue" icon={<MessageSquare size={20} strokeWidth={1.5} />} title={`Dialogue (${(preferences.shortcuts.scriptDialogue || 'ctrl+5').toUpperCase()})`} label="Dialogue" />
          <LineTypeButton editor={editor} type="transition" icon={<ChevronsRight size={20} strokeWidth={1.5} />} title={`Transition (${(preferences.shortcuts.scriptTransition || 'ctrl+6').toUpperCase()})`} label="Transition" />
        </div>
        
        {/* Main Editor Area */}
        <div 
          className="flex-1 overflow-y-auto p-12 bg-[#151515] border-l border-r border-black shadow-inner"
          onMouseDown={(e) => {
            const el = e.target as HTMLElement;
            const inEditor = el.closest('.ProseMirror, [contenteditable="true"]');
            if (inEditor) return;
            // Stop flexlayout from treating this as a tab drag; do NOT preventDefault — that blocks
            // the browser from focusing the contenteditable on the next click.
            e.stopPropagation();
            setTimeout(() => {
              editor?.commands.focus();
            }, 0);
          }}
          onClick={(e) => {
            // Failsafe: if they clicked inside the white document, ensure it truly receives focus natively.
            if ((e.target as HTMLElement).closest('.ProseMirror')) {
              setTimeout(() => {
                if (editor && !editor.isFocused) {
                  editor.commands.focus();
                }
              }, 10);
            }
          }}
          onKeyDownCapture={(e) => {
            // Never intercept deletion keys here — TipTap / ProseMirror must handle them. A persisted
            // shortcut accidentally set to "backspace" would otherwise preventDefault and block deletes.
            if (e.key === 'Backspace' || e.key === 'Delete') return;

            const prefs = preferences.shortcuts;

            let val = e.key.toLowerCase();
            if (val === ' ') val = 'space';
            const modifiers = [];
            if (e.ctrlKey || e.metaKey) modifiers.push('ctrl');
            if (e.shiftKey) modifiers.push('shift');
            if (e.altKey) modifiers.push('alt');

            const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${val}` : val;

            if (combo === (prefs.scriptScene || 'ctrl+1')) { e.preventDefault(); editor?.commands.setNode('sceneHeading'); }
            else if (combo === (prefs.scriptAction || 'ctrl+2')) { e.preventDefault(); editor?.commands.setNode('action'); }
            else if (combo === (prefs.scriptCharacter || 'ctrl+3')) { e.preventDefault(); editor?.commands.setNode('character'); }
            else if (combo === (prefs.scriptParenthetical || 'ctrl+4')) { e.preventDefault(); editor?.commands.setNode('parenthetical'); }
            else if (combo === (prefs.scriptDialogue || 'ctrl+5')) { e.preventDefault(); editor?.commands.setNode('dialogue'); }
            else if (combo === (prefs.scriptTransition || 'ctrl+6')) { e.preventDefault(); editor?.commands.setNode('transition'); }
          }}
        >
          <div 
            className="max-w-[850px] mx-auto min-h-[1100px] bg-[#ffffff] text-black shadow-2xl screenplay-editor"
            style={{ '--script-font-size': `${preferences.scriptSettings?.fontSize || 14}px` } as React.CSSProperties}
            onPointerDownCapture={(e) => {
              const a = (e.target as HTMLElement).closest('a');
              const raw = a?.getAttribute('href');
              if (raw?.startsWith('script-card:') || raw?.startsWith('script-page:')) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onAuxClickCapture={(e) => {
              if (e.button !== 1) return;
              const a = (e.target as HTMLElement).closest('a');
              const raw = a?.getAttribute('href');
              if (raw?.startsWith('script-card:') || raw?.startsWith('script-page:')) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onClickCapture={(e) => {
              const a = (e.target as HTMLElement).closest('a');
              const raw = a?.getAttribute('href') || '';
              if (!raw.startsWith('script-card:') && !raw.startsWith('script-page:')) return;
              e.preventDefault();
              e.stopPropagation();
              navigateInternalScriptHrefRef.current(raw);
            }}
          >
             <EditorContent editor={editor} className="h-full cursor-text py-[1in] px-[1in]" />
          </div>
        </div>

        {/* Right sidebar: resizable width; scroll tab row so Comments stays reachable */}
        <div className="flex shrink-0 z-10 font-sans shadow-xl" style={{ width: rightSidebarWidth }}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize script sidebar"
            onPointerDown={beginSidebarResize}
            className="w-1.5 shrink-0 cursor-col-resize hover:bg-blue-500/35 active:bg-blue-500/55 border-l border-black"
          />
          <div className="flex min-w-0 flex-1 flex-col bg-[#323232] border-l border-black">
           <div className="flex shrink-0 overflow-x-auto overflow-y-hidden text-[11px] font-semibold text-[#9ca3af] border-b border-black bg-[#282828] tracking-wider uppercase">
             <div 
               onClick={() => setActiveRightTab('documents')}
               className={`shrink-0 px-3 py-3 border-b-2 cursor-pointer transition-colors ${activeRightTab === 'documents' ? 'border-blue-500 text-white' : 'border-transparent hover:text-white hover:bg-[#323232]'}`}
             >
               Docs
             </div>
             <div 
               onClick={() => setActiveRightTab('outline')}
               className={`shrink-0 px-3 py-3 border-b-2 cursor-pointer transition-colors ${activeRightTab === 'outline' ? 'border-blue-500 text-white' : 'border-transparent hover:text-white hover:bg-[#323232]'}`}
             >
               Outline
             </div>
             <div 
               onClick={() => setActiveRightTab('info')}
               className={`shrink-0 px-3 py-3 border-b-2 cursor-pointer transition-colors ${activeRightTab === 'info' ? 'border-blue-500 text-white' : 'border-transparent hover:text-white hover:bg-[#323232]'}`}
             >
               Info
             </div>
             <div 
               onClick={() => setActiveRightTab('notes')}
               className={`shrink-0 px-3 py-3 border-b-2 cursor-pointer transition-colors ${activeRightTab === 'notes' ? 'border-blue-500 text-white' : 'border-transparent hover:text-white hover:bg-[#323232]'}`}
             >
               Notes
             </div>
             <div 
               onClick={() => setActiveRightTab('comments')}
               className={`shrink-0 px-3 py-3 border-b-2 cursor-pointer transition-colors ${activeRightTab === 'comments' ? 'border-blue-500 text-white' : 'border-transparent hover:text-white hover:bg-[#323232]'}`}
             >
               Comments
             </div>
           </div>
           
           <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#323232]">
              {activeRightTab === 'documents' && (
                <div className="flex flex-col gap-2 h-full text-sm">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-white text-xs uppercase tracking-wider">Project Documents</h3>
                    <button onClick={handleNewPage} className="text-neutral-400 hover:text-white p-1 rounded hover:bg-neutral-700 bg-black/20" title="New Document">
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {allPages.map(page => (
                      <div 
                        key={page.id}
                        className={`flex items-center justify-between p-2 rounded cursor-pointer border transition-colors ${activeScriptPageId === page.id ? 'bg-[#3b82f6] border-blue-400 text-white shadow-sm' : 'bg-[#282828] border-black text-neutral-400 hover:bg-[#333]'}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setActiveScriptPageId(page.id)}
                      >
                        <div 
                          className="flex-1 min-w-0"
                        >
                          {editingTabId === page.id ? (
                            <input 
                              autoFocus
                              maxLength={30}
                              value={editingTabName}
                              onChange={e => setEditingTabName(e.target.value)}
                              onBlur={() => {
                                if (editingTabName.trim() !== '') {
                                  updateNodeName(page.id, editingTabName.trim());
                                }
                                setEditingTabId(null);
                              }}
                              onKeyDown={e => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  if (editingTabName.trim() !== '') {
                                    updateNodeName(page.id, editingTabName.trim());
                                  }
                                  setEditingTabId(null);
                                } else if (e.key === 'Escape') {
                                  setEditingTabId(null);
                                }
                              }}
                              className="bg-[#151515] text-white px-1 outline-none w-full rounded border border-blue-500"
                              onClick={e => e.stopPropagation()}
                              onDoubleClick={e => e.stopPropagation()}
                              onMouseDown={e => e.stopPropagation()}
                            />
                          ) : (
                            <div className="truncate select-none" title="Double click to rename" onDoubleClick={(e) => {
                              e.stopPropagation();
                              setEditingTabId(page.id);
                              setEditingTabName(page.name);
                            }}>{page.name}</div>
                          )}
                        </div>
                        {editingTabId !== page.id && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteScriptPage(page);
                            }}
                            className="p-1 hover:bg-black/30 rounded text-neutral-500 hover:text-red-400 shrink-0 ml-2"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {activeRightTab === 'outline' && outlineItems.map((item, index) => (
                <div key={item.id} 
                  onClick={() => {
                    editor?.chain().focus().setTextSelection(item.pos).scrollIntoView().run();
                  }}
                  className="bg-[#e2e8f0] p-4 rounded-sm shadow-[2px_2px_4px_rgba(0,0,0,0.3)] text-black flex flex-col gap-2 cursor-pointer hover:bg-white hover:-translate-y-0.5 transition-all relative group border-t-8 border-[#9ca3af]"
                >
                  <div className="flex justify-between items-start">
                    <div className="font-bold text-[11px] uppercase tracking-wide text-neutral-800 leading-tight">
                      <span className="text-[#6b7280] mr-1">{index + 1}.</span> {item.title}
                    </div>
                  </div>
                  <div className="text-[11px] text-neutral-600 font-mono leading-relaxed line-clamp-4">Scene card. Click to jump to scene.</div>
                </div>
              ))}

              {activeRightTab === 'info' && (
                <div className="flex flex-col gap-4 text-sm">
                  <div className="bg-[#282828] p-3 rounded border border-black shadow-inner">
                    <h3 className="font-bold text-white mb-2 text-xs uppercase tracking-wider">Project Info</h3>
                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">Title</label>
                        <input 
                          type="text" 
                          className="w-full bg-[#151515] border border-black rounded p-1.5 text-white text-xs" 
                          value={project?.name || ''} 
                          onChange={(e) => updateProjectName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">Author</label>
                        <input 
                          type="text" 
                          className="w-full bg-[#151515] border border-black rounded p-1.5 text-white text-xs" 
                          placeholder="Author Name" 
                          value={project?.settings?.author || ''}
                          onChange={(e) => updateProjectSettings({ author: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-neutral-500 block mb-1">Stats</label>
                        <div className="text-xs text-neutral-400">
                          Scenes: {project?.scenes.length || 0}<br/>
                          Pages: {allPages.length || 0}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeRightTab === 'notes' && (
                <div className="flex flex-col gap-2 h-full text-sm">
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider">Global Scratchpad</h3>
                  <textarea 
                    value={project?.settings?.notes || ''}
                    onChange={(e) => updateProjectSettings({ notes: e.target.value })}
                    className="flex-1 w-full bg-[#282828] border border-black rounded p-3 text-neutral-300 text-sm resize-none focus:outline-none focus:border-blue-500 shadow-inner"
                    placeholder="Jot down quick ideas, dialogue snippets, or structural notes here..."
                  />
                </div>
              )}

              {activeRightTab === 'comments' && (
                <div
                  className="flex flex-col gap-2 h-full text-sm"
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocusCapture={() => {
                    if (commentSidebarBlurTimerRef.current) {
                      clearTimeout(commentSidebarBlurTimerRef.current);
                      commentSidebarBlurTimerRef.current = null;
                    }
                    commentSidebarFocusRef.current = true;
                  }}
                  onBlurCapture={() => {
                    commentSidebarBlurTimerRef.current = setTimeout(() => {
                      commentSidebarFocusRef.current = false;
                    }, 200);
                  }}
                >
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider mb-2">Comment</h3>
                  {activeCommentData ? (
                    <div className="bg-[#282828] p-3 rounded border border-black shadow-inner flex flex-col gap-3">
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Author</div>
                        <input 
                          type="text" 
                          value={activeCommentData.author}
                          onChange={(e) => {
                            const newAuthor = e.target.value;
                            setActiveCommentData((prev) => (prev ? { ...prev, author: newAuthor } : null));
                            const ed = editorRef.current;
                            if (ed && activeCommentId) {
                              applyCommentAttrsById(ed, activeCommentId, { author: newAuthor, timestamp: Date.now() });
                            }
                          }}
                          className="w-full bg-[#151515] border border-black rounded p-1.5 text-white text-xs"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Note</div>
                        <textarea 
                          value={activeCommentData.text}
                          onChange={(e) => {
                            const newText = e.target.value;
                            setActiveCommentData((prev) => (prev ? { ...prev, text: newText } : null));
                            const ed = editorRef.current;
                            if (ed && activeCommentId) {
                              applyCommentAttrsById(ed, activeCommentId, { text: newText, timestamp: Date.now() });
                            }
                          }}
                          className="w-full h-32 bg-[#151515] border border-black rounded p-1.5 text-white text-xs resize-none"
                        />
                      </div>
                      <button 
                        onClick={() => {
                          if (editor) {
                            editor.chain().focus().unsetMark('comment').run();
                            setActiveCommentId(null);
                            setActiveCommentData(null);
                            setActiveRightTab('documents');
                          }
                        }}
                        className="w-full py-1.5 bg-red-900/50 hover:bg-red-800 text-red-200 text-xs rounded border border-red-900 transition-colors mt-2"
                      >
                        Delete Comment
                      </button>
                    </div>
                  ) : (
                    <div className="text-neutral-500 text-xs text-center mt-10">
                      Click on highlighted text to view its comment, or select text and click the Comment icon in the toolbar to add a new one.
                    </div>
                  )}
                </div>
              )}
           </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LineTypeButton = ({ editor, type, icon, title, label }: { editor: any, type: string, icon: React.ReactNode, title: string, label: string }) => {
  const isActive = editor?.isActive(type);
  
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault(); // Prevent losing focus from the editor
        if (editor) {
          editor.commands.focus();
          editor.commands.setNode(type);
        }
      }}
      className={`w-full py-2 transition-all flex flex-col items-center justify-center gap-1 border-l-4 ${
        isActive 
          ? 'bg-[#444] border-blue-500 text-white shadow-inner' 
          : 'border-transparent text-[#9ca3af] hover:bg-[#444] hover:text-white'
      }`}
      title={title}
    >
      <div className="opacity-80">{icon}</div>
      <span className="text-[10px] font-medium tracking-wide">{label}</span>
    </button>
  );
};
