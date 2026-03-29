import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Plus, X } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useAppStore } from '../store/appStore';
import type { ScriptPage } from '@common/models';

import {
  SceneHeading,
  Action,
  Character,
  Dialogue,
  Parenthetical,
  Transition,
  ScreenplayShortcuts,
  ScreenplayDefaultEnter,
  CommentMark,
  CustomListItem,
} from '../tiptap/ScreenplayNodes';
import { ScreenplayPagination } from '../tiptap/ScreenplayPagination';
import { ScreenplayTabCycle } from '../tiptap/ScreenplayTabCycle';
import { ScreenplayFolding } from '../tiptap/ScreenplayFolding';
import { handleScreenplayAutoCapitalize, ScreenplaySentenceCapState } from '../lib/screenplayAutoCapitalize';

import {
  AFTER_NATIVE_DIALOG_EVENT,
  nativeConfirm,
  restoreElectronWindowKeyboardFocus,
  scheduleReturnFocusToProseMirror,
} from '../lib/focusAfterNativeDialog';
import { base64ToUtf8Text, utf8TextToBase64 } from '../lib/scriptContentBase64';

import { 
  US_LETTER_PAGE_CSS_PX, 
  gutterMarkersFromPaper, 
  findSceneHeadingDocumentPos, 
  applyCommentAttrsById 
} from '../lib/scriptEditorUtils';

import { ScriptMenuBar } from './ScriptMenuBar';
import { ScriptLeftToolbar } from './ScriptLeftToolbar';

export const ScriptEditor: React.FC = () => {
  const { project, activeScriptPageId, setActiveScriptPageId, updateScriptPageContent, addPageToFolder, removeNode, updateNodeName, updateProjectSettings, updateProjectName } = useProjectStore();
  const { preferences } = useAppStore();
  const scriptLayout = preferences.scriptSettings?.layout ?? 'print';
  const paginationEnabledRef = useRef(scriptLayout === 'print');
  paginationEnabledRef.current = scriptLayout === 'print';
  
  const lastSyncedContentRef = useRef<string | null>(null);
  const lastSyncedEditorRef = useRef<any>(null);
  
  const paperRef = useRef<HTMLDivElement>(null);
  const [paperScrollHeight, setPaperScrollHeight] = useState(US_LETTER_PAGE_CSS_PX);
  const [printGutterMarkers, setPrintGutterMarkers] = useState<{ num: number; top: number }[]>([]);

  const [activeRightTab, setActiveRightTab] = React.useState<'outline' | 'documents' | 'info' | 'notes' | 'comments'>('documents');
  const [editingTabId, setEditingTabId] = React.useState<string | null>(null);
  const [editingTabName, setEditingTabName] = React.useState('');
  const editingTabIdRef = useRef<string | null>(null);
  
  useEffect(() => {
    editingTabIdRef.current = editingTabId;
  }, [editingTabId]);

  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [activeCommentData, setActiveCommentData] = useState<{id: string, text: string, author: string} | null>(null);

  const pendingCardNavRef = useRef<{ pageId: string; sceneIndex: number } | null>(null);
  const commentSidebarFocusRef = useRef(false);
  const commentSidebarBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
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

  const allPages = useMemo(() => {
    if (!project || !project.rootScriptFolder) return [];
    let pages: ScriptPage[] = [];
    const traverse = (folder: any) => {
      if (!folder || !folder.children) return;
      folder.children.forEach((c: any) => {
        if (c.type === 'page') pages.push(c);
        else if (c.type === 'folder') traverse(c);
      });
    };
    traverse(project.rootScriptFolder);
    return pages;
  }, [project]);

  const [outlineItems, setOutlineItems] = useState<{id: string, title: string, pos: number}[]>([]);

  const isUpdatingRef = useRef(false);
  const loadingPageContentRef = useRef(false);
  const editorRef = useRef<any>(null);
  const activeScriptPageIdRef = useRef<string | null>(activeScriptPageId);
  activeScriptPageIdRef.current = activeScriptPageId;
  const navigateInternalScriptHrefRef = useRef<(href: string) => void>(() => {});

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
      handleClickOn: (_view: unknown, _pos: number, node: any) => {
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

  const scriptEditorExtensions = useMemo(
    () => [
      Action,
      StarterKit.configure({ listItem: false }),
      CustomListItem,    
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
      ScreenplayFolding,
      ScreenplayPagination.configure({
        getEnabled: () => paginationEnabledRef.current,
        pageBodyHeightPx: 864,
      }),
      ScreenplayTabCycle,
      ScreenplayDefaultEnter,
      CommentMark,
    ],
    [],
  );

  const updateOutline = useCallback((editorInstance: any) => {
    if (!editorInstance) return;
    const items: {id: string, title: string, pos: number}[] = [];
    editorInstance.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'sceneHeading') {
        items.push({ id: pos.toString(), title: node.textContent || 'Empty Scene', pos });
      }
    });
    setOutlineItems(items);
  }, []);

  const editor = useEditor({
    extensions: scriptEditorExtensions,
    content: '<p class="action"></p>',
    editable: true,
    editorProps: scriptEditorProps,
    onUpdate: ({ editor: ed }) => {
      if (loadingPageContentRef.current) return;
      const pageId = activeScriptPageIdRef.current;
      if (!pageId) return;

      isUpdatingRef.current = true;
      try {
        const json = ed.getJSON();
        const b64 = utf8TextToBase64(JSON.stringify(json));
        lastSyncedContentRef.current = b64;
        updateScriptPageContent(pageId, b64);
      } catch (err) {
        console.error('Failed to persist script page', err);
      } finally {
        isUpdatingRef.current = false;
      }
      updateOutline(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (commentSidebarFocusRef.current) return;

      try {
        let foundComment = false;
        if (ed.isActive('comment')) {
          const a = ed.getAttributes('comment');
          if (a.commentId) {
            setActiveCommentId(a.commentId);
            setActiveCommentData({ id: a.commentId, text: a.text ?? '', author: a.author ?? '' });
            setActiveRightTab('comments');
            foundComment = true;
          }
        }
        if (!foundComment) {
          const { state } = ed;
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
                  author: commentMark.attrs.author 
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
      } catch { /* transient invalid state */ }
    },
    onBlur: () => {},
  }, [project?.id ?? '__no_project__']);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const recalcPaperMetrics = useCallback(() => {
    if (scriptLayout !== 'print') return;
    const el = paperRef.current;
    if (!el) return;
    setPaperScrollHeight(el.scrollHeight);
    requestAnimationFrame(() => {
      const p = paperRef.current;
      if (p) setPrintGutterMarkers(gutterMarkersFromPaper(p));
    });
  }, [scriptLayout]);

  useEffect(() => {
    recalcPaperMetrics();
  }, [recalcPaperMetrics, activeScriptPageId, scriptLayout]);

  useEffect(() => {
    if (scriptLayout !== 'print') return;
    const el = paperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recalcPaperMetrics());
    ro.observe(el);
    return () => ro.disconnect();
  }, [scriptLayout, recalcPaperMetrics]);

  useEffect(() => {
    if (!editor || scriptLayout !== 'print') return;
    const run = () => requestAnimationFrame(() => recalcPaperMetrics());
    editor.on('update', run);
    editor.on('transaction', run);
    return () => {
      editor.off('update', run);
      editor.off('transaction', run);
    };
  }, [editor, scriptLayout, recalcPaperMetrics]);

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

  // SYNC EFFECT
  useEffect(() => {
    if (!editor || !project || !project.rootScriptFolder) return;

    let storeBase64 = '';
    const findPage = (folder: any) => {
      if (!folder || !folder.children) return false;
      for (const child of folder.children) {
        if (child.type === 'page' && child.id === activeScriptPageId) {
          storeBase64 = child.contentBase64 || '';
          return true;
        } else if (child.type === 'folder') {
          if (findPage(child)) return true;
        }
      }
      return false;
    };
    if (activeScriptPageId) findPage(project.rootScriptFolder);

    const isNewEditorInstance = lastSyncedEditorRef.current !== editor;

    if (storeBase64 !== lastSyncedContentRef.current || isNewEditorInstance) {
      loadingPageContentRef.current = true;
      try {
        const decoded = base64ToUtf8Text(storeBase64);
        let contentToSet: any = decoded === '' ? '<p class="action"></p>' : decoded;
        try {
          contentToSet = JSON.parse(decoded);
        } catch { /* use raw string */ }

        try {
          editor.chain().setContent(contentToSet).setMeta('addToHistory', false).run();
        } catch (chainErr) {
          editor.commands.setContent(contentToSet);
        }

        if (typeof (editor.commands as any).clearHistory === 'function') {
          (editor.commands as any).clearHistory();
        }
        
        lastSyncedContentRef.current = storeBase64;
        lastSyncedEditorRef.current = editor;
        updateOutline(editor);
      } finally {
        loadingPageContentRef.current = false;
      }
    }

    queueMicrotask(() => {
      if (scriptLayout === 'print') editor.commands.repaginateScript();
    });

    if (activeScriptPageId) {
      const runFocus = () => {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
        if (commentSidebarFocusRef.current || loadingPageContentRef.current || editingTabIdRef.current) return;
        editor.commands.focus();
        scheduleReturnFocusToProseMirror();
      };
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(runFocus, 0)));
    }
  }, [activeScriptPageId, editor, project, scriptLayout, updateOutline]); 

  useEffect(() => {
    if (scriptLayout !== 'print') setPrintGutterMarkers([]);
  }, [scriptLayout]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (scriptLayout === 'print') editor.commands.repaginateScript();
    else editor.commands.stripScriptPageBreaks();
  }, [scriptLayout, editor]);

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
      if (pos != null) ed.chain().setTextSelection(pos + 1).scrollIntoView().focus().run();
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
     const docsFolder = project.rootScriptFolder.children.find((c: any) => c.type === 'folder' && c.name === 'Documents');
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

  const scriptPaperStyle = { '--script-font-size': `${preferences.scriptSettings?.fontSize || 14}px` } as React.CSSProperties;
  const scriptPaperClass = scriptLayout === 'print'
      ? 'min-h-[11in] w-full max-w-[8.5in] flex-1 overflow-x-visible overflow-y-visible rounded-sm bg-[#ffffff] text-black shadow-2xl screenplay-editor script-print-paginated'
      : 'mx-auto min-h-[1100px] max-w-[850px] bg-[#ffffff] text-black shadow-2xl screenplay-editor';

  const scriptPaperEl = (
    <div
      ref={paperRef}
      className={scriptPaperClass}
      style={scriptPaperStyle}
      onPointerDownCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a?.getAttribute('href')?.startsWith('script-')) { 
          e.preventDefault(); 
          e.stopPropagation(); 
        }
      }}
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        const raw = a?.getAttribute('href') || '';
        if (!raw.startsWith('script-')) return;
        e.preventDefault(); 
        e.stopPropagation();
        navigateInternalScriptHrefRef.current(raw);
      }}
    >
      <EditorContent
        editor={editor}
        className={scriptLayout === 'print' ? 'h-full cursor-text overflow-visible py-[1in] px-[1in]' : 'h-full cursor-text py-[1in] px-[1in]'}
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-neutral-200 overflow-hidden font-sans">
      
      {preferences.scriptSettings?.showPageBreaks === false && (
        <style>{`
          .screenplay-editor .script-page-break-decorator {
            opacity: 0 !important;
            pointer-events: none !important;
          }
        `}</style>
      )}

      <div className="flex items-center bg-[#282828] border-b border-black overflow-x-auto shrink-0 select-none group">
        {allPages.map(page => (
          <div 
            key={page.id} 
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setActiveScriptPageId(page.id)}
            className={`px-4 py-2 text-[13px] font-medium cursor-pointer border-r border-black flex items-center gap-2 transition-colors relative group/tab ${
              activeScriptPageId === page.id 
                ? 'bg-[#323232] text-white border-t-2 border-t-blue-500' 
                : 'bg-[#282828] text-neutral-400 hover:bg-[#323232] border-t-2 border-t-transparent'
            }`}
          >
            <span className="whitespace-nowrap select-none">{page.name}</span>
            <button 
              onClick={(e) => { e.stopPropagation(); void handleDeleteScriptPage(page); }} 
              className={`p-0.5 rounded hover:bg-black/30 hover:text-red-400 ml-1 ${activeScriptPageId === page.id ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'}`} 
              title="Close/Delete Page"
            >
              <X size={14}/>
            </button>
          </div>
        ))}
        <button 
          onClick={handleNewPage} 
          className="p-2 ml-1 text-neutral-400 hover:text-white hover:bg-[#323232] rounded" 
          title="New Script Document"
        >
          <Plus size={16} />
        </button>
      </div>

      <ScriptMenuBar 
        editor={editor} 
        allPages={allPages} 
        activeScriptPageId={activeScriptPageId} 
        outlineItems={outlineItems} 
        onAddComment={(id, data) => {
          setActiveCommentId(id);
          setActiveCommentData({ id, text: data.text, author: data.author });
          setActiveRightTab('comments');
          setTimeout(() => {
            const el = document.getElementById('active-comment-textarea') as HTMLTextAreaElement;
            if (el) { el.focus(); el.select(); }
          }, 100);
        }}
      />
      
      <div className="flex flex-1 overflow-hidden">
        <ScriptLeftToolbar editor={editor} />
        
        <div 
          className={
            scriptLayout === 'print' 
              ? 'flex-1 overflow-y-auto p-8 bg-zinc-600 border-l border-r border-black shadow-inner custom-scrollbar' 
              : 'flex-1 overflow-y-auto p-12 bg-[#151515] border-l border-r border-black shadow-inner custom-scrollbar'
          }
          onMouseDown={(e) => {
            const el = e.target as HTMLElement;
            if (el.closest('.ProseMirror, [contenteditable="true"]')) return;
            e.stopPropagation();
            setTimeout(() => editor?.commands.focus(), 0);
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.ProseMirror')) {
              setTimeout(() => { if (editor && !editor.isFocused) editor.commands.focus(); }, 10);
            }
          }}
          onKeyDownCapture={(e) => {
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
          {scriptLayout === 'print' ? (
            <div className="mx-auto flex w-full max-w-[calc(8.5in+3.5rem)] items-start justify-center gap-2 sm:gap-3">
              <div className="relative w-9 shrink-0 select-none sm:w-11" style={{ height: paperScrollHeight }}>
                {printGutterMarkers.map(({ num, top }) => (
                  <span 
                    key={num} 
                    className="absolute right-0 text-[1.65rem] font-light leading-none tracking-tight text-zinc-300 sm:text-3xl" 
                    style={{ top: `${top}px`, transform: 'translateY(-50%)' }}
                  >
                    {num}
                  </span>
                ))}
              </div>
              {scriptPaperEl}
            </div>
          ) : (
            scriptPaperEl
          )}
        </div>

        <div className="flex shrink-0 z-10 font-sans shadow-xl" style={{ width: rightSidebarWidth }}>
          <div 
            role="separator" 
            aria-label="Resize script sidebar" 
            onPointerDown={beginSidebarResize} 
            className="w-1.5 shrink-0 cursor-col-resize hover:bg-blue-500/35 active:bg-blue-500/55 border-l border-black" 
          />
          <div className="flex min-w-0 flex-1 flex-col bg-[#323232] border-l border-black">
           <div className="flex shrink-0 overflow-x-auto overflow-y-hidden text-[11px] font-semibold text-[#9ca3af] border-b border-black bg-[#282828] tracking-wider uppercase">
             {['documents', 'outline', 'info', 'notes', 'comments'].map(tab => (
               <div 
                 key={tab} 
                 onClick={() => setActiveRightTab(tab as any)} 
                 className={`shrink-0 px-3 py-3 border-b-2 cursor-pointer transition-colors ${
                   activeRightTab === tab 
                     ? 'border-blue-500 text-white' 
                     : 'border-transparent hover:text-white hover:bg-[#323232]'
                 }`}
               >
                 {tab.charAt(0).toUpperCase() + tab.slice(1, 4)}
               </div>
             ))}
           </div>
           
           <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#323232] custom-scrollbar">
              
              {activeRightTab === 'documents' && (
                <div className="flex flex-col gap-2 h-full text-sm">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-bold text-white text-xs uppercase tracking-wider">Project Documents</h3>
                    <button 
                      onClick={handleNewPage} 
                      className="text-neutral-400 hover:text-white p-1 rounded hover:bg-neutral-700 bg-black/20"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {allPages.map(page => (
                      <div 
                        key={page.id} 
                        className={`flex items-center justify-between p-2 rounded cursor-pointer border transition-colors group/item ${
                          activeScriptPageId === page.id 
                            ? 'bg-[#3b82f6] border-blue-400 text-white' 
                            : 'bg-[#282828] border-black text-neutral-400 hover:bg-[#333]'
                        }`} 
                        onClick={() => setActiveScriptPageId(page.id)}
                      >
                        <div className="flex-1 min-w-0">
                          {editingTabId === page.id ? (
                            <input 
                              autoFocus 
                              ref={(el) => { 
                                if (el && document.activeElement !== el) {
                                  setTimeout(() => { el.focus(); el.select(); }, 50); 
                                }
                              }} 
                              maxLength={30} 
                              value={editingTabName} 
                              onChange={e => setEditingTabName(e.target.value)} 
                              onBlur={() => { 
                                if (editingTabName.trim() !== '' && editingTabName.trim() !== page.name) {
                                  updateNodeName(page.id, editingTabName.trim()); 
                                }
                                setEditingTabId(null); 
                              }} 
                              onKeyDown={e => { 
                                e.stopPropagation(); 
                                if (e.key === 'Enter') {
                                  (e.target as HTMLInputElement).blur(); 
                                } else if (e.key === 'Escape') {
                                  setEditingTabId(null); 
                                }
                              }} 
                              className="bg-[#151515] text-white px-1 outline-none w-full rounded border border-blue-500" 
                              onMouseDown={e => e.stopPropagation()} 
                            />
                          ) : (
                            <span 
                              className="truncate select-none cursor-text w-full" 
                              title="Double-click to rename" 
                              onDoubleClick={(e) => { 
                                e.preventDefault(); 
                                e.stopPropagation(); 
                                setEditingTabId(page.id); 
                                setEditingTabName(page.name); 
                              }}
                            >
                              {page.name}
                            </span>
                          )}
                        </div>
                        {editingTabId !== page.id && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); void handleDeleteScriptPage(page); }} 
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
                <div 
                  key={item.id} 
                  onClick={() => editor?.chain().focus().setTextSelection(item.pos).scrollIntoView().run()} 
                  className="bg-[#e2e8f0] p-4 rounded-sm shadow-md text-black flex flex-col gap-2 cursor-pointer hover:bg-white hover:-translate-y-0.5 transition-all border-t-8 border-[#9ca3af]"
                >
                  <div className="font-bold text-[11px] uppercase tracking-wide text-neutral-800 leading-tight">
                    <span className="text-[#6b7280] mr-1">{index + 1}.</span> {item.title}
                  </div>
                </div>
              ))}

              {activeRightTab === 'info' && (
                <div className="bg-[#282828] p-3 rounded border border-black shadow-inner flex flex-col gap-2">
                  <h3 className="font-bold text-white mb-2 text-xs uppercase tracking-wider">Project Info</h3>
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
                  <div className="text-xs text-neutral-400">
                    Scenes: {project?.scenes?.length || 0}<br/>
                    Pages: {allPages.length || 0}
                  </div>
                </div>
              )}

              {activeRightTab === 'notes' && (
                <div className="flex flex-col gap-2 h-full text-sm">
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider">Global Scratchpad</h3>
                  <textarea 
                    value={project?.settings?.notes || ''} 
                    onChange={(e) => updateProjectSettings({ notes: e.target.value })} 
                    className="flex-1 w-full bg-[#282828] border border-black rounded p-3 text-neutral-300 text-sm resize-none focus:outline-none focus:border-blue-500 custom-scrollbar" 
                    placeholder="Jot down quick ideas..." 
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
                            setActiveCommentData(prev => prev ? { ...prev, author: newAuthor } : null); 
                            if (editorRef.current && activeCommentId) {
                              applyCommentAttrsById(editorRef.current, activeCommentId, { author: newAuthor, timestamp: Date.now() }); 
                            }
                          }} 
                          className="w-full bg-[#151515] border border-black rounded p-1.5 text-white text-xs" 
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">Note</div>
                        <textarea 
                          id="active-comment-textarea" 
                          value={activeCommentData.text} 
                          onChange={(e) => { 
                            const newText = e.target.value; 
                            setActiveCommentData(prev => prev ? { ...prev, text: newText } : null); 
                            if (editorRef.current && activeCommentId) {
                              applyCommentAttrsById(editorRef.current, activeCommentId, { text: newText, timestamp: Date.now() }); 
                            }
                          }} 
                          className="w-full h-32 bg-[#151515] border border-black rounded p-1.5 text-white text-xs resize-none custom-scrollbar focus:outline-none focus:border-blue-500" 
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
                    <div className="text-neutral-500 text-xs text-center mt-10">Select text and click Comment to add notes.</div> 
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