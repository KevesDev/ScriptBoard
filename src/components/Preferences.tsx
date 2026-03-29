import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useProjectStore } from '../store/projectStore';
import { IPC_CHANNELS } from '@common/ipc';
import { nativeAlert } from '../lib/focusAfterNativeDialog';
import { X, Keyboard, FileText, ChevronRight, FolderArchive, Layers } from 'lucide-react';

type PrefCategory = 'files' | 'storyboard' | 'script';

const CATEGORY_META: { id: PrefCategory; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'files', label: 'Files & backups', description: 'Autosave & project copies', icon: <FolderArchive size={18} /> },
  { id: 'storyboard', label: 'Storyboard', description: 'Canvas, zoom, pan', icon: <Keyboard size={18} /> },
  { id: 'script', label: 'Script', description: 'Font & line shortcuts', icon: <FileText size={18} /> },
];

export const Preferences = () => {
  const { preferences, isPreferencesOpen, setPreferencesOpen, setPreferences, resetPreferences } = useAppStore();
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const [activeCategory, setActiveCategory] = useState<PrefCategory>('files');

  const files = preferences.files ?? { autoSaveEnabled: true, autoSaveIntervalMinutes: 5, backupEnabled: true, backupIntervalMinutes: 30 };

  if (!isPreferencesOpen) return null;

  const handleShortcutChange = (key: keyof typeof preferences.shortcuts, value: string) => {
    setPreferences({
      ...preferences,
      shortcuts: { ...preferences.shortcuts, [key]: value.toLowerCase() },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, key: keyof typeof preferences.shortcuts) => {
    e.preventDefault();
    e.stopPropagation();

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

    let val = e.key.toLowerCase();
    if (val === ' ') val = 'space';

    const modifiers = [];
    if (e.ctrlKey || e.metaKey) modifiers.push('ctrl');
    if (e.shiftKey) modifiers.push('shift');
    if (e.altKey) modifiers.push('alt');

    const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${val}` : val;

    handleShortcutChange(key, combo);
  };

  const verifySavePathExists = async (): Promise<boolean> => {
    if (window.ipcRenderer && project?.id) {
      try {
        const q = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_QUERY_SAVE_PATH, project.id);
        if (q?.success && q.data && !q.data.hasPath) {
          await nativeAlert(
            'Save this project first with File → Save or Save As.\n\n' +
              'Autosaves and backups require a known project folder to operate.',
          );
          return false;
        }
      } catch {
        /* browser / no IPC */
      }
    }
    return true;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-6">
      <div
        className="flex w-full max-w-4xl max-h-[min(88vh,900px)] flex-col overflow-hidden rounded-2xl border border-neutral-700/90 bg-[#1c1c1c] shadow-2xl shadow-black/50"
        role="dialog"
        aria-labelledby="preferences-title"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-black bg-[#141414] px-5 py-3.5">
          <div>
            <h2 id="preferences-title" className="text-lg font-semibold tracking-tight text-white">
              Preferences
            </h2>
            <p className="text-xs text-neutral-500">Application defaults - saved automatically</p>
          </div>
          <button
            type="button"
            onClick={() => setPreferencesOpen(false)}
            className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-label="Close preferences"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 gap-1 border-b border-black bg-[#181818] p-2 md:w-52 md:flex-col md:border-b-0 md:border-r md:p-3">
            {CATEGORY_META.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? 'bg-blue-600/20 text-white ring-1 ring-blue-500/40'
                      : 'text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200'
                  }`}
                >
                  <span className={isActive ? 'text-blue-400' : 'text-neutral-500'}>{cat.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{cat.label}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{cat.description}</span>
                  </span>
                  <ChevronRight size={16} className={`shrink-0 md:hidden ${isActive ? 'text-blue-400' : 'text-neutral-600'}`} />
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#1f1f1f]">
            <div className="p-5 sm:p-6">
              {activeCategory === 'files' && (
                <section className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Project files & backups</h3>
                    <p className="mt-1 text-xs text-neutral-500">Configure how ScriptBoard automatically preserves your work.</p>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-blue-600" checked={files.autoSaveEnabled !== false} onChange={async (e) => { const on = e.target.checked; if (!on) { setPreferences({ files: { ...files, autoSaveEnabled: false } }); return; } if (await verifySavePathExists()) { setPreferences({ files: { ...files, autoSaveEnabled: true } }); } }} />
                      <span>
                        <span className="text-sm font-medium text-neutral-200">Autosave</span>
                        <span className="mt-1 block text-xs text-neutral-500">Automatically overwrites your main <span className="font-mono">.sbproj</span> file so you don't lose progress.</span>
                      </span>
                    </label>
                    <div className="mt-4 pl-7">
                      <label className="mb-2 block text-xs text-neutral-400">Autosave Interval</label>
                      <select className="w-full max-w-xs rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200" value={files.autoSaveIntervalMinutes ?? 5} disabled={files.autoSaveEnabled === false} onChange={(e) => setPreferences({ files: { ...files, autoSaveIntervalMinutes: Number(e.target.value) }, })}>
                        {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => ( <option key={m} value={m}>Every {m} minutes</option> ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-blue-600" checked={files.backupEnabled !== false} onChange={async (e) => { const on = e.target.checked; if (!on) { setPreferences({ files: { ...files, backupEnabled: false } }); return; } if (await verifySavePathExists()) { setPreferences({ files: { ...files, backupEnabled: true } }); } }} />
                      <span>
                        <span className="text-sm font-medium text-neutral-200">Secondary Backup (Sidecar)</span>
                        <span className="mt-1 block text-xs text-neutral-500">Periodically writes a separate copy named <span className="font-mono">Name.bak.sbproj</span>.</span>
                      </span>
                    </label>
                    <div className="mt-4 pl-7">
                      <label className="mb-2 block text-xs text-neutral-400">Backup Interval</label>
                      <select className="w-full max-w-xs rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200" value={files.backupIntervalMinutes ?? 30} disabled={files.backupEnabled === false} onChange={(e) => setPreferences({ files: { ...files, backupIntervalMinutes: Number(e.target.value) }, })}>
                        {[1, 2, 3, 5, 10, 15, 30, 60, 120].map((m) => ( <option key={m} value={m}>Every {m} minutes</option> ))}
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {activeCategory === 'storyboard' && (
                <section className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Storyboard & canvas</h3>
                    <p className="mt-1 text-xs text-neutral-500">Click a field, then press the new key. Undo/Redo use Control/Command automatically.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ShortcutInput label="Undo" value={preferences.shortcuts.undo} onKeyDown={(e) => handleKeyDown(e, 'undo')} />
                    <ShortcutInput label="Redo" value={preferences.shortcuts.redo} onKeyDown={(e) => handleKeyDown(e, 'redo')} />
                    <ShortcutInput label="Copy strokes" value={preferences.shortcuts.copy} onKeyDown={(e) => handleKeyDown(e, 'copy')} />
                    <ShortcutInput label="Cut strokes" value={preferences.shortcuts.cut} onKeyDown={(e) => handleKeyDown(e, 'cut')} />
                    <ShortcutInput label="Paste strokes" value={preferences.shortcuts.paste} onKeyDown={(e) => handleKeyDown(e, 'paste')} />
                    <ShortcutInput label="Pan canvas (hold)" value={preferences.shortcuts.pan} onKeyDown={(e) => handleKeyDown(e, 'pan')} />
                    
                    <ShortcutInput label="Canvas zoom in" value={preferences.shortcuts.zoomIn} onKeyDown={(e) => handleKeyDown(e, 'zoomIn')} />
                    <ShortcutInput label="Canvas zoom out" value={preferences.shortcuts.zoomOut} onKeyDown={(e) => handleKeyDown(e, 'zoomOut')} />
                    
                    <ShortcutInput label="Timeline zoom in" value={preferences.shortcuts.timelineZoomIn} onKeyDown={(e) => handleKeyDown(e, 'timelineZoomIn')} />
                    <ShortcutInput label="Timeline zoom out" value={preferences.shortcuts.timelineZoomOut} onKeyDown={(e) => handleKeyDown(e, 'timelineZoomOut')} />
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <h4 className="text-sm font-medium text-neutral-200">Timeline framerate (FPS)</h4>
                    <p className="mt-1 text-xs text-neutral-500">Used for timecode display, frame snapping on the timeline, and animatic export.</p>
                    {project ? (
                      <>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {[24, 25, 30].map((preset) => (
                            <button key={preset} type="button" onClick={() => updateProjectSettings({ framerate: preset })} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${ (project.settings.framerate ?? 24) === preset ? 'border-blue-500 bg-blue-600/20 text-blue-200' : 'border-neutral-600 bg-neutral-900 text-neutral-300 hover:border-neutral-500' }`}>
                              {preset} fps
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <label className="text-xs text-neutral-400" htmlFor="sb-framerate-custom">Custom</label>
                          <input id="sb-framerate-custom" type="number" min={1} max={120} step={1} className="w-24 rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200" value={project.settings.framerate && project.settings.framerate > 0 ? project.settings.framerate : 24} onChange={(e) => { const v = Math.round(Number(e.target.value)); if (!Number.isFinite(v)) return; updateProjectSettings({ framerate: Math.min(120, Math.max(1, v)) }); }} />
                          <span className="text-[11px] text-neutral-500">1-120</span>
                        </div>
                      </>
                    ) : ( <p className="mt-2 text-xs text-neutral-500">Open or create a project to edit timeline framerate.</p> )}
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Layers size={18} className="text-blue-400" />
                      <h4 className="text-sm font-medium text-neutral-200">Onion skin</h4>
                    </div>
                    {(() => {
                      const os = preferences.onionSkin;
                      if (!os) return null;
                      return (
                        <div className="space-y-4">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-blue-600" checked={os.startEnabled} onChange={(e) => setPreferences({ onionSkin: { ...os, startEnabled: e.target.checked }, }) } />
                            <span><span className="text-sm font-medium text-neutral-200">Start with onion skin on</span></span>
                          </label>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Panels before</label>
                              <select className="w-full rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200" value={os.panelsBefore} onChange={(e) => setPreferences({ onionSkin: { ...os, panelsBefore: Number(e.target.value) }, }) }>
                                {[0, 1, 2, 3, 4, 5].map((n) => ( <option key={n} value={n}>{n === 0 ? 'None' : n}</option> ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Panels after</label>
                              <select className="w-full rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200" value={os.panelsAfter} onChange={(e) => setPreferences({ onionSkin: { ...os, panelsAfter: Number(e.target.value) }, }) }>
                                {[0, 1, 2, 3, 4, 5].map((n) => ( <option key={n} value={n}>{n === 0 ? 'None' : n}</option> ))}
                              </select>
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Previous tint</label>
                              <input type="color" className="h-10 w-full cursor-pointer rounded-lg border border-neutral-700 bg-[#141414]" value={os.previousColor} onChange={(e) => setPreferences({ onionSkin: { ...os, previousColor: e.target.value }, }) } />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Next tint</label>
                              <input type="color" className="h-10 w-full cursor-pointer rounded-lg border border-neutral-700 bg-[#141414]" value={os.nextColor} onChange={(e) => setPreferences({ onionSkin: { ...os, nextColor: e.target.value }, }) } />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </section>
              )}

              {activeCategory === 'script' && (
                <section className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Script editor</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ShortcutInput label="Scene heading" value={preferences.shortcuts.scriptScene || 'ctrl+1'} onKeyDown={(e) => handleKeyDown(e, 'scriptScene')} />
                    <ShortcutInput label="Action" value={preferences.shortcuts.scriptAction || 'ctrl+2'} onKeyDown={(e) => handleKeyDown(e, 'scriptAction')} />
                    <ShortcutInput label="Character" value={preferences.shortcuts.scriptCharacter || 'ctrl+3'} onKeyDown={(e) => handleKeyDown(e, 'scriptCharacter')} />
                    <ShortcutInput label="Parenthetical" value={preferences.shortcuts.scriptParenthetical || 'ctrl+4'} onKeyDown={(e) => handleKeyDown(e, 'scriptParenthetical')} />
                    <ShortcutInput label="Dialogue" value={preferences.shortcuts.scriptDialogue || 'ctrl+5'} onKeyDown={(e) => handleKeyDown(e, 'scriptDialogue')} />
                    <ShortcutInput label="Transition" value={preferences.shortcuts.scriptTransition || 'ctrl+6'} onKeyDown={(e) => handleKeyDown(e, 'scriptTransition')} />
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-black bg-[#141414] px-5 py-3">
          <button type="button" onClick={resetPreferences} className="rounded-lg px-4 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white">Reset defaults</button>
          <button type="button" onClick={() => setPreferencesOpen(false)} className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500">Done</button>
        </footer>
      </div>
    </div>
  );
};

const ShortcutInput = ({ label, value, onKeyDown }: { label: string; value: string; onKeyDown: (e: React.KeyboardEvent) => void; }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-medium text-neutral-500">{label}</label>
    <input type="text" readOnly value={value ? value.toUpperCase() : ''} onKeyDown={onKeyDown} className="cursor-pointer rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2.5 text-center font-mono text-sm text-white shadow-inner transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40" />
  </div>
);