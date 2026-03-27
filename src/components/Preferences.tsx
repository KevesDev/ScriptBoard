import React, { useState } from 'react';
import { useAppStore, type ScriptEditorLayout } from '../store/appStore';
import { useProjectStore } from '../store/projectStore';
import { IPC_CHANNELS } from '@common/ipc';
import { nativeAlert } from '../lib/focusAfterNativeDialog';
import { X, Keyboard, PenLine, FileText, ChevronRight, FolderArchive, Layers } from 'lucide-react';

type PrefCategory = 'files' | 'storyboard' | 'brushes' | 'script';

const CATEGORY_META: { id: PrefCategory; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'files', label: 'Files & backups', description: 'Autosave next to your project', icon: <FolderArchive size={18} /> },
  { id: 'storyboard', label: 'Storyboard', description: 'Canvas, zoom, pan', icon: <Keyboard size={18} /> },
  { id: 'brushes', label: 'Brushes', description: 'Engine & custom tips', icon: <PenLine size={18} /> },
  { id: 'script', label: 'Script', description: 'Font & line shortcuts', icon: <FileText size={18} /> },
];

export const Preferences = () => {
  const { preferences, isPreferencesOpen, setPreferencesOpen, setPreferences, resetPreferences } = useAppStore();
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const [activeCategory, setActiveCategory] = useState<PrefCategory>('files');

  const files = preferences.files ?? { autoSaveEnabled: true, autoSaveIntervalMinutes: 5 };

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
                    <p className="mt-1 text-xs text-neutral-500">
                      Your main project is a <span className="font-mono text-neutral-400">.sbproj</span> file. Automatic backups use
                      the same folder and appear as <span className="font-mono text-neutral-400">Name.autosave.sbproj</span> (they
                      do not replace the main file).
                    </p>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-blue-600"
                        checked={files.autoSaveEnabled !== false}
                        onChange={async (e) => {
                          const on = e.target.checked;
                          if (!on) {
                            setPreferences({ files: { ...files, autoSaveEnabled: false } });
                            return;
                          }
                          if (window.ipcRenderer && project?.id) {
                            try {
                              const q = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_QUERY_SAVE_PATH, project.id);
                              if (q?.success && q.data && !q.data.hasPath) {
                                await nativeAlert(
                                  'Save this project first with File → Save or Save As.\n\n' +
                                    'Backups are always stored in the same folder as your main .sbproj file, so we need that location before turning this on.',
                                );
                                return;
                              }
                            } catch {
                              /* browser / no IPC: allow toggle */
                            }
                          }
                          setPreferences({ files: { ...files, autoSaveEnabled: true } });
                        }}
                      />
                      <span>
                        <span className="text-sm font-medium text-neutral-200">Automatic timed backups</span>
                        <span className="mt-1 block text-xs text-neutral-500">
                          When enabled, ScriptBoard periodically writes the sidecar{' '}
                          <span className="font-mono">.autosave.sbproj</span> next to your saved project. Save the project
                          at least once so we know which folder to use.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="mb-2 block text-sm text-neutral-300">Backup interval</label>
                    <select
                      className="w-full max-w-xs rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200"
                      value={files.autoSaveIntervalMinutes ?? 5}
                      disabled={files.autoSaveEnabled === false}
                      onChange={(e) =>
                        setPreferences({
                          files: { ...files, autoSaveIntervalMinutes: Number(e.target.value) },
                        })
                      }
                    >
                      {[1, 2, 3, 5, 10, 15, 30].map((m) => (
                        <option key={m} value={m}>
                          Every {m} minutes
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-[11px] text-neutral-500">
                      After each manual Save or Save As, the backup file is refreshed immediately when this option is on.
                    </p>
                  </div>

                </section>
              )}

              {activeCategory === 'storyboard' && (
                <section className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Storyboard & canvas</h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      Click a field, then press the new key. Undo/Redo use Control/Command automatically.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ShortcutInput label="Undo" value={preferences.shortcuts.undo} onKeyDown={(e) => handleKeyDown(e, 'undo')} />
                    <ShortcutInput label="Redo" value={preferences.shortcuts.redo} onKeyDown={(e) => handleKeyDown(e, 'redo')} />
                    <ShortcutInput label="Copy strokes" value={preferences.shortcuts.copy} onKeyDown={(e) => handleKeyDown(e, 'copy')} />
                    <ShortcutInput label="Cut strokes" value={preferences.shortcuts.cut} onKeyDown={(e) => handleKeyDown(e, 'cut')} />
                    <ShortcutInput label="Paste strokes" value={preferences.shortcuts.paste} onKeyDown={(e) => handleKeyDown(e, 'paste')} />
                    <ShortcutInput label="Zoom in" value={preferences.shortcuts.zoomIn} onKeyDown={(e) => handleKeyDown(e, 'zoomIn')} />
                    <ShortcutInput label="Zoom out" value={preferences.shortcuts.zoomOut} onKeyDown={(e) => handleKeyDown(e, 'zoomOut')} />
                    <ShortcutInput
                      label="Pan canvas (hold)"
                      value={preferences.shortcuts.pan}
                      onKeyDown={(e) => handleKeyDown(e, 'pan')}
                    />
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <h4 className="text-sm font-medium text-neutral-200">Timeline framerate (FPS)</h4>
                    <p className="mt-1 text-xs text-neutral-500">
                      Used for timecode display, frame snapping on the timeline, and animatic MP4/MOV export frame rate.
                    </p>
                    {project ? (
                      <>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {[24, 25, 30].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => updateProjectSettings({ framerate: preset })}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                (project.settings.framerate ?? 24) === preset
                                  ? 'border-blue-500 bg-blue-600/20 text-blue-200'
                                  : 'border-neutral-600 bg-neutral-900 text-neutral-300 hover:border-neutral-500'
                              }`}
                            >
                              {preset} fps
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <label className="text-xs text-neutral-400" htmlFor="sb-framerate-custom">
                            Custom
                          </label>
                          <input
                            id="sb-framerate-custom"
                            type="number"
                            min={1}
                            max={120}
                            step={1}
                            className="w-24 rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200"
                            value={project.settings.framerate && project.settings.framerate > 0 ? project.settings.framerate : 24}
                            onChange={(e) => {
                              const v = Math.round(Number(e.target.value));
                              if (!Number.isFinite(v)) return;
                              updateProjectSettings({ framerate: Math.min(120, Math.max(1, v)) });
                            }}
                          />
                          <span className="text-[11px] text-neutral-500">1-120</span>
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-neutral-500">Open or create a project to edit timeline framerate.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Layers size={18} className="text-blue-400" />
                      <h4 className="text-sm font-medium text-neutral-200">Onion skin</h4>
                    </div>
                    <p className="mb-4 text-xs text-neutral-500">
                      Ghost neighboring panels in the same scene while you draw (toggle on the canvas toolbar). Adjust tint,
                      opacity, and how many panels appear before and after the current one.
                    </p>

                    {(() => {
                      const os = preferences.onionSkin;
                      if (!os) return null;
                      return (
                        <div className="space-y-4">
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-blue-600"
                              checked={os.startEnabled}
                              onChange={(e) =>
                                setPreferences({
                                  onionSkin: { ...os, startEnabled: e.target.checked },
                                })
                              }
                            />
                            <span>
                              <span className="text-sm font-medium text-neutral-200">Start with onion skin on</span>
                              <span className="mt-0.5 block text-[11px] text-neutral-500">
                                When you open the canvas, onion skin begins enabled (you can still turn it off with the toolbar
                                button).
                              </span>
                            </span>
                          </label>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Panels before</label>
                              <select
                                className="w-full rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200"
                                value={os.panelsBefore}
                                onChange={(e) =>
                                  setPreferences({
                                    onionSkin: { ...os, panelsBefore: Number(e.target.value) },
                                  })
                                }
                              >
                                {[0, 1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={n}>
                                    {n === 0 ? 'None' : n}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Panels after</label>
                              <select
                                className="w-full rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2 text-sm text-neutral-200"
                                value={os.panelsAfter}
                                onChange={(e) =>
                                  setPreferences({
                                    onionSkin: { ...os, panelsAfter: Number(e.target.value) },
                                  })
                                }
                              >
                                {[0, 1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={n}>
                                    {n === 0 ? 'None' : n}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Previous panels tint</label>
                              <input
                                type="color"
                                className="h-10 w-full cursor-pointer rounded-lg border border-neutral-700 bg-[#141414]"
                                value={os.previousColor}
                                onChange={(e) =>
                                  setPreferences({
                                    onionSkin: { ...os, previousColor: e.target.value },
                                  })
                                }
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs text-neutral-400">Next panels tint</label>
                              <input
                                type="color"
                                className="h-10 w-full cursor-pointer rounded-lg border border-neutral-700 bg-[#141414]"
                                value={os.nextColor}
                                onChange={(e) =>
                                  setPreferences({
                                    onionSkin: { ...os, nextColor: e.target.value },
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div>
                            <label className="mb-2 flex justify-between text-sm text-neutral-300">
                              <span>Closest neighbor opacity</span>
                              <span className="font-mono text-neutral-400">{os.nearestOpacityPercent}%</span>
                            </label>
                            <input
                              type="range"
                              min={5}
                              max={100}
                              step={1}
                              value={os.nearestOpacityPercent}
                              onChange={(e) =>
                                setPreferences({
                                  onionSkin: { ...os, nearestOpacityPercent: Number(e.target.value) },
                                })
                              }
                              className="h-2 w-full cursor-pointer accent-blue-500"
                            />
                          </div>

                          <div>
                            <label className="mb-2 flex justify-between text-sm text-neutral-300">
                              <span>Fade per step</span>
                              <span className="font-mono text-neutral-400">{Math.round(os.fadePerStep * 100)}%</span>
                            </label>
                            <p className="mb-2 text-[11px] text-neutral-500">
                              Each panel farther from the current one is multiplied by this (lower = faster fade).
                            </p>
                            <input
                              type="range"
                              min={20}
                              max={100}
                              step={1}
                              value={Math.round(os.fadePerStep * 100)}
                              onChange={(e) =>
                                setPreferences({
                                  onionSkin: { ...os, fadePerStep: Number(e.target.value) / 100 },
                                })
                              }
                              className="h-2 w-full cursor-pointer accent-blue-500"
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </section>
              )}

              {activeCategory === 'brushes' && (
                <section className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Brush engine</h3>
                    <p className="mt-1 text-xs text-neutral-500">Tweak default raster brush feel and manage imported PNG tips.</p>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="mb-2 flex justify-between text-sm text-neutral-300">
                      <span>Pencil texture noise</span>
                      <span className="font-mono text-neutral-400">{Math.round(preferences.brushSettings.pencilNoise * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      value={preferences.brushSettings.pencilNoise}
                      onChange={(e) =>
                        setPreferences({
                          brushSettings: { ...preferences.brushSettings, pencilNoise: parseFloat(e.target.value) },
                        })
                      }
                      className="h-2 w-full cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="mb-2 flex justify-between text-sm text-neutral-300">
                      <span>Marker opacity (build-up)</span>
                      <span className="font-mono text-neutral-400">{Math.round(preferences.brushSettings.markerOpacity * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={preferences.brushSettings.markerOpacity}
                      onChange={(e) =>
                        setPreferences({
                          brushSettings: { ...preferences.brushSettings, markerOpacity: parseFloat(e.target.value) },
                        })
                      }
                      className="h-2 w-full cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Custom brush tips</h4>
                    <div className="space-y-2">
                      {preferences.customBrushes.map((brush) => (
                        <div
                          key={brush.id}
                          className="flex items-center justify-between rounded-lg border border-neutral-800 bg-[#1a1a1a] px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {brush.textureBase64 && (
                              <img src={brush.textureBase64} alt="" className="h-8 w-8 shrink-0 rounded bg-white object-contain" />
                            )}
                            <span className="truncate text-sm font-medium text-neutral-200">{brush.name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => useAppStore.getState().removeCustomBrush(brush.id)}
                            className="shrink-0 rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                            aria-label={`Remove ${brush.name}`}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}

                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-700 bg-[#161616] px-4 py-4 text-sm text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-200">
                        <input
                          type="file"
                          accept="image/png"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const base64 = event.target?.result as string;
                              useAppStore.getState().addCustomBrush({
                                id: crypto.randomUUID(),
                                name: file.name.replace(/\.png$/i, ''),
                                spacing: 0.1,
                                scatter: 0,
                                rotationMode: 'path',
                                rotationAngle: 0,
                                flow: 0.8,
                                pressureSize: true,
                                pressureOpacity: true,
                                textureBase64: base64,
                              });
                            };
                            reader.readAsDataURL(file);
                            e.target.value = '';
                          }}
                        />
                        <span>+ Import PNG brush tip</span>
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {activeCategory === 'script' && (
                <section className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Script editor</h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      Tab / Shift+Tab cycle screenplay line types (scene → action → character → parenthetical → dialogue →
                      transition). Ctrl/Cmd+1–6 still jump to a type directly.
                    </p>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-600 bg-neutral-900 accent-blue-600"
                        checked={preferences.scriptSettings?.autoCapitalizeFirstLetter !== false}
                        onChange={(e) =>
                          setPreferences({
                            scriptSettings: {
                              ...(preferences.scriptSettings || {}),
                              autoCapitalizeFirstLetter: e.target.checked,
                            },
                          })
                        }
                      />
                      <span>
                        <span className="text-sm font-medium text-neutral-200">Auto-capitalize in Action & Dialogue</span>
                        <span className="mt-1 block text-xs text-neutral-500">
                          Uppercases the first letter of a new line and the first letter after a sentence end (. ! ?) followed by a
                          space. If you change a
                          letter to lowercase (typing or selection), it will not be forced back to uppercase.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <div className="mb-3 text-sm font-medium text-neutral-200">Layout</div>
                    <p className="mb-3 text-xs text-neutral-500">
                      Print pages automatically inserts page breaks so each page fits roughly US Letter body text (9″ tall between 1″
                      top/bottom margins). Page numbers sit in the left gutter. Very long single blocks are not split mid-paragraph.
                      Continuous is one long sheet (previous default look).
                    </p>
                    <div className="flex flex-col gap-2">
                      {(
                        [
                          { id: 'print' as const, label: 'Print pages', sub: '8.5″ width, auto page breaks, gutter numbers' },
                          { id: 'continuous' as const, label: 'Continuous', sub: 'Single scroll, dark margins' },
                        ] satisfies { id: ScriptEditorLayout; label: string; sub: string }[]
                      ).map((opt) => (
                        <label
                          key={opt.id}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 has-[:checked]:border-blue-600/50 has-[:checked]:bg-blue-950/20"
                        >
                          <input
                            type="radio"
                            name="script-layout"
                            className="mt-0.5 h-4 w-4 shrink-0 border-neutral-600 bg-neutral-900 accent-blue-600"
                            checked={(preferences.scriptSettings?.layout ?? 'print') === opt.id}
                            onChange={() =>
                              setPreferences({
                                scriptSettings: {
                                  ...(preferences.scriptSettings || {}),
                                  layout: opt.id,
                                },
                              })
                            }
                          />
                          <span>
                            <span className="text-sm font-medium text-neutral-200">{opt.label}</span>
                            <span className="mt-0.5 block text-xs text-neutral-500">{opt.sub}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-800 bg-[#1a1a1a] p-4">
                    <label className="mb-2 flex justify-between text-sm text-neutral-300">
                      <span>Default font size</span>
                      <span className="font-mono text-neutral-400">{preferences.scriptSettings?.fontSize || 14}px</span>
                    </label>
                    <input
                      type="range"
                      min="8"
                      max="32"
                      step="1"
                      value={preferences.scriptSettings?.fontSize || 14}
                      onChange={(e) =>
                        setPreferences({
                          scriptSettings: { ...preferences.scriptSettings, fontSize: parseInt(e.target.value, 10) },
                        })
                      }
                      className="h-2 w-full cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Line type shortcuts</h4>
                    <p className="mb-3 text-xs text-neutral-500">Click a field, then press the combo (Ctrl/Cmd is detected).</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ShortcutInput
                        label="Scene heading"
                        value={preferences.shortcuts.scriptScene || 'ctrl+1'}
                        onKeyDown={(e) => handleKeyDown(e, 'scriptScene')}
                      />
                      <ShortcutInput
                        label="Action"
                        value={preferences.shortcuts.scriptAction || 'ctrl+2'}
                        onKeyDown={(e) => handleKeyDown(e, 'scriptAction')}
                      />
                      <ShortcutInput
                        label="Character"
                        value={preferences.shortcuts.scriptCharacter || 'ctrl+3'}
                        onKeyDown={(e) => handleKeyDown(e, 'scriptCharacter')}
                      />
                      <ShortcutInput
                        label="Parenthetical"
                        value={preferences.shortcuts.scriptParenthetical || 'ctrl+4'}
                        onKeyDown={(e) => handleKeyDown(e, 'scriptParenthetical')}
                      />
                      <ShortcutInput
                        label="Dialogue"
                        value={preferences.shortcuts.scriptDialogue || 'ctrl+5'}
                        onKeyDown={(e) => handleKeyDown(e, 'scriptDialogue')}
                      />
                      <ShortcutInput
                        label="Transition"
                        value={preferences.shortcuts.scriptTransition || 'ctrl+6'}
                        onKeyDown={(e) => handleKeyDown(e, 'scriptTransition')}
                      />
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-black bg-[#141414] px-5 py-3">
          <button
            type="button"
            onClick={resetPreferences}
            className="rounded-lg px-4 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={() => setPreferencesOpen(false)}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};

const ShortcutInput = ({
  label,
  value,
  onKeyDown,
}: {
  label: string;
  value: string;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-medium text-neutral-500">{label}</label>
    <input
      type="text"
      readOnly
      value={value.toUpperCase()}
      onKeyDown={onKeyDown}
      className="cursor-pointer rounded-lg border border-neutral-700 bg-[#141414] px-3 py-2.5 text-center font-mono text-sm text-white shadow-inner transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
    />
  </div>
);
