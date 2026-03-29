import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Model, TabNode, Actions } from 'flexlayout-react';
import type { IJsonModel, Action } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { IPC_CHANNELS } from '@common/ipc';
import type { IpcResponse } from '@common/ipc';
import { useProjectStore, generateEmptyProject } from './store/projectStore';
import type { Project } from '@common/models';
import { TitleBar } from './components/TitleBar';
import { ScriptEditor } from './components/ScriptEditor';
import { Outliner } from './components/Outliner';
import { DrawingCanvas } from './components/DrawingCanvas';
import { Inspector } from './components/Inspector';
import { Preferences } from './components/Preferences';
import { ExportHub } from './components/ExportHub';
import { Timeline } from './components/Timeline';
import { PlotTreeEditor } from './components/PlotTree';
import { useAppStore } from './store/appStore';
import { nativeAlert, nativeConfirm } from './lib/focusAfterNativeDialog';
import { GlobalShortcutManager } from './components/GlobalShortcutManager';
import { Logger } from './lib/logger';

class ComponentErrorBoundary extends React.Component<{children: React.ReactNode, name: string}, {hasError: boolean, error: Error | null}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Logger.error('ErrorBoundary', `Component crashed: ${this.props.name}`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full bg-neutral-950 text-neutral-300 p-6 flex flex-col items-center justify-center font-sans text-sm">
          <div className="bg-neutral-900 border border-red-900 p-4 rounded-lg shadow-2xl max-w-lg w-full">
            <h2 className="text-red-400 font-bold mb-2 flex items-center gap-2 uppercase tracking-wide text-xs">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
               Component Crash: {this.props.name}
            </h2>
            <p className="text-neutral-400 mb-4 text-xs">An unexpected error occurred. The developer log has recorded the stack trace.</p>
            <div className="bg-black/80 p-3 rounded overflow-auto max-h-32 text-[10px] font-mono text-red-300/80 custom-scrollbar">
              {this.state.error?.toString()}
            </div>
            <button 
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-xs transition-colors"
            >
              Attempt Recovery
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const layoutConfig: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableTabStrip: true, 
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 100,
        id: 'main-workspace',
        children: [
          {
            type: 'tab',
            id: 'tab-storyboard',
            name: 'Storyboard Mode',
            component: 'storyboardWorkspace',
          },
          {
            type: 'tab',
            id: 'tab-script',
            name: 'Script Mode',
            component: 'scriptWorkspace',
          }
        ]
      }
    ]
  }
};

const scriptWorkspaceModel = Model.fromJson({
  global: { tabEnableClose: false, tabEnableRename: false, tabSetEnableTabStrip: true },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      { 
        type: 'tabset', 
        weight: 100, 
        children: [
          { type: 'tab', name: 'Script Editor', component: 'scriptEditor' },
          { type: 'tab', name: 'Plot Tree', component: 'plotTree' }
        ] 
      }
    ]
  }
});

const storyboardWorkspaceModel = Model.fromJson({
  global: { tabEnableClose: false, tabEnableRename: false, tabSetEnableTabStrip: false },
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 20,
        children: [{ type: 'tab', name: 'Outliner', component: 'outliner' }]
      },
      {
        type: 'column',
        weight: 60,
        children: [
          { type: 'tabset', weight: 70, children: [{ type: 'tab', name: 'Canvas', component: 'canvas' }] },
          { type: 'tabset', weight: 30, children: [{ type: 'tab', name: 'Timeline', component: 'timeline' }] }
        ]
      },
      {
        type: 'tabset',
        weight: 20,
        children: [{ type: 'tab', name: 'Inspector', component: 'inspector' }]
      }
    ]
  }
});

function GlobalMenuBar({
  onNewProject,
  onLoadProject,
  onSaveProject,
  onSaveProjectAs,
  onImportScript,
  onOpenExportHub,
  onPreferences,
  onExit
}: any) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  return (
    <div className="flex items-center px-2 py-1 bg-neutral-900 border-b border-neutral-800 text-xs font-medium text-neutral-300 relative select-none">
      <div 
        className="relative"
        onMouseEnter={() => setFileMenuOpen(true)}
        onMouseLeave={() => setFileMenuOpen(false)}
      >
        <button className="px-3 py-1 hover:bg-neutral-800 rounded">File</button>
        {fileMenuOpen && (
          <div className="absolute top-full left-0 mt-0 bg-neutral-800 border border-neutral-700 shadow-xl rounded-b rounded-tr w-48 py-1 z-50 flex flex-col">
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onNewProject(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">New Project</button>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onLoadProject(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">Open Project...</button>
            <div className="h-px bg-neutral-700 my-1 mx-2"></div>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSaveProject(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">Save</button>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSaveProjectAs(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">Save As...</button>
            <div className="h-px bg-neutral-700 my-1 mx-2"></div>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onImportScript(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">Import Script...</button>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onOpenExportHub(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">Export…</button>
            <div className="h-px bg-neutral-700 my-1 mx-2"></div>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onPreferences(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-blue-600 hover:text-white transition-colors">Preferences</button>
            <div className="h-px bg-neutral-700 my-1 mx-2"></div>
            <button onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onExit(); setFileMenuOpen(false); }} className="text-left px-4 py-1.5 hover:bg-red-600 hover:text-white transition-colors">Exit</button>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [model] = useState<Model>(Model.fromJson(layoutConfig));
  const [exportHubOpen, setExportHubOpen] = useState(false);
  const activeModeRef = useRef<'script' | 'storyboard'>('storyboard');
  const project = useProjectStore((s) => s.project);

  useEffect(() => {
    if (!useProjectStore.getState().project) {
      useProjectStore.getState().setProject(generateEmptyProject());
    }
  }, []);

  const handleFlexLayoutAction = (action: Action) => {
    if (action.type === Actions.SELECT_TAB) {
      if (action.data.tabNode === 'tab-script') {
        activeModeRef.current = 'script';
      } else if (action.data.tabNode === 'tab-storyboard') {
        activeModeRef.current = 'storyboard';
      }
    }
    return action;
  };

  const handleNewProject = async () => {
    if (await nativeConfirm('Are you sure? Unsaved changes will be lost.')) {
      useProjectStore.getState().setProject(generateEmptyProject());
    }
  };

  const handleSaveProject = async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      await nativeAlert('No project loaded!');
      return;
    }
    if (!window.ipcRenderer) {
      await nativeAlert('IPC Renderer not available! Are you running in browser mode?');
      return;
    }
    try {
      const serializedProject = JSON.parse(JSON.stringify(project));
      const res: IpcResponse = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SAVE, serializedProject);
      if (res.success) {
        const files = useAppStore.getState().preferences?.files;
        if (files?.backupEnabled !== false) {
          const latest = useProjectStore.getState().project;
          if (latest) {
            void window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_AUTOSAVE, latest).catch(() => {});
          }
        }
        await nativeAlert('Project saved successfully!');
      } else if (res.message !== 'Save canceled') {
        console.error('Save failed:', res.message);
        await nativeAlert(`Save failed: ${res.message}`);
      }
    } catch (err) {
      console.error('IPC Save Error:', err);
      await nativeAlert('An unexpected error occurred while saving the project.');
    }
  };

  const handleSaveProjectAs = async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      await nativeAlert('No project loaded!');
      return;
    }
    if (!window.ipcRenderer) {
      await nativeAlert('IPC Renderer not available!');
      return;
    }
    try {
      const serializedProject = JSON.parse(JSON.stringify(project));
      const res: IpcResponse = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SAVE_AS, serializedProject);
      if (res.success) {
        const files = useAppStore.getState().preferences?.files;
        if (files?.backupEnabled !== false && window.ipcRenderer) {
          const latest = useProjectStore.getState().project;
          if (latest) {
            void window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_AUTOSAVE, latest).catch(() => {});
          }
        }
        await nativeAlert('Project saved successfully!');
      } else if (res.message !== 'Save canceled') {
        console.error('Save As failed:', res.message);
        await nativeAlert(`Save As failed: ${res.message}`);
      }
    } catch (err) {
      console.error('IPC Save As Error:', err);
      await nativeAlert('An unexpected error occurred while saving the project.');
    }
  };

  const handleLoadProject = async () => {
    if (!window.ipcRenderer) return;
    try {
      const res: IpcResponse<{ project: Project, filePath: string }> = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LOAD);
      if (res.success && res.data) {
        useProjectStore.getState().setProject(res.data.project);
      } else if (res.message !== 'Load canceled') {
        console.error('Load failed:', res.message);
        await nativeAlert(`Load failed: ${res.message}`);
      }
    } catch (err) {
      console.error('IPC Load Error:', err);
      await nativeAlert('An unexpected error occurred while loading the project.');
    }
  };

  const handleImportScript = async () => {
    const project = useProjectStore.getState().project;
    if (!project || !window.ipcRenderer) return;
    try {
      const res: IpcResponse<{ content: string, fileName: string }> = await window.ipcRenderer.invoke(IPC_CHANNELS.SCRIPT_IMPORT);
      if (res.success && res.data) {
        useProjectStore.getState().importScriptPage(res.data.fileName, res.data.content);
      } else if (res.message !== 'Import canceled') {
        console.error('Import failed:', res.message);
        await nativeAlert(`Import failed: ${res.message}`);
      }
    } catch (err) {
      console.error('IPC Import Error:', err);
      await nativeAlert('An unexpected error occurred while importing the script.');
    }
  };

  const autoSaveEnabled = useAppStore((s) => s.preferences?.files?.autoSaveEnabled ?? true);
  const autoSaveMinutes = useAppStore((s) => s.preferences?.files?.autoSaveIntervalMinutes ?? 5);

  const backupEnabled = useAppStore((s) => s.preferences?.files?.backupEnabled ?? true);
  const backupMinutes = useAppStore((s) => s.preferences?.files?.backupIntervalMinutes ?? 30);

  const backupPromptedIdsRef = useRef<Set<string>>(new Set());

  const checkAndPromptUnsaved = useCallback(async (proj: Project) => {
    if (!window.ipcRenderer) return false;
    const q = await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_QUERY_SAVE_PATH, proj.id);
    if (!q?.data?.hasPath) {
      if (!backupPromptedIdsRef.current.has(proj.id)) {
        backupPromptedIdsRef.current.add(proj.id);
        await nativeAlert(
          'Autosaves and/or Backups are enabled, but this project has not been saved yet.\n\n' +
          'Please use File → Save or Save As once. After that, ScriptBoard will automatically protect your work.'
        );
      }
      return false;
    }
    return true;
  }, []);

  const runBackup = useCallback(async () => {
    if (!window.ipcRenderer) return;
    const proj = useProjectStore.getState().project;
    if (!proj || !backupEnabled) return;
    try {
      if (!(await checkAndPromptUnsaved(proj))) return;
      await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_AUTOSAVE, proj);
    } catch (e) {
      console.error('Backup failed:', e);
    }
  }, [backupEnabled, checkAndPromptUnsaved]);

  const runAutoSaveMain = useCallback(async () => {
    if (!window.ipcRenderer) return;
    const proj = useProjectStore.getState().project;
    if (!proj || !autoSaveEnabled) return;
    try {
      if (!(await checkAndPromptUnsaved(proj))) return;
      const serializedProject = JSON.parse(JSON.stringify(proj));
      await window.ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SAVE, serializedProject);
    } catch (e) {
      console.error('Main Autosave failed:', e);
    }
  }, [autoSaveEnabled, checkAndPromptUnsaved]);

  useEffect(() => {
    if (!autoSaveEnabled) return;
    const minutes = Math.min(120, Math.max(1, autoSaveMinutes));
    const id = window.setInterval(() => void runAutoSaveMain(), minutes * 60 * 1000);
    return () => clearInterval(id);
  }, [autoSaveEnabled, autoSaveMinutes, runAutoSaveMain]);

  useEffect(() => {
    if (!backupEnabled) return;
    const minutes = Math.min(120, Math.max(1, backupMinutes));
    const id = window.setInterval(() => void runBackup(), minutes * 60 * 1000);
    return () => clearInterval(id);
  }, [backupEnabled, backupMinutes, runBackup]);

  const factory = (node: TabNode) => {
    const component = node.getComponent();
    
    switch (component) {
      case 'scriptWorkspace':
        return (
          <div className="h-full w-full" key="script">
            <Layout 
              model={scriptWorkspaceModel} 
              factory={(subNode) => {
                try {
                  switch(subNode.getComponent()) {
                    case 'scriptEditor':
                      return (
                        <ComponentErrorBoundary name="ScriptEditor">
                          <div className="h-full bg-[#1e1e1e] flex flex-col">
                            <ScriptEditor />
                          </div>
                        </ComponentErrorBoundary>
                      );
                    case 'plotTree':
                      return (
                        <ComponentErrorBoundary name="PlotTree">
                          <div className="h-full w-full bg-[#1e1e1e] flex flex-col">
                            <PlotTreeEditor />
                          </div>
                        </ComponentErrorBoundary>
                      );
                    default: return <div className="h-full bg-[#1e1e1e]">Not found</div>;
                  }
                } catch (e) {
                  Logger.error('Layout', 'Error rendering component', e);
                  return <div className="h-full bg-[#1e1e1e] p-4 text-red-500">Error rendering {subNode.getComponent()}</div>;
                }
              }} 
            />
          </div>
        );
      case 'storyboardWorkspace':
        return (
          <div className="h-full w-full" key="storyboard">
            <Layout 
              model={storyboardWorkspaceModel} 
              factory={(subNode) => {
                try {
                  switch(subNode.getComponent()) {
                    case 'canvas': return (
                      <ComponentErrorBoundary name="DrawingCanvas">
                        <div className="w-full h-full relative">
                          <DrawingCanvas />
                        </div>
                      </ComponentErrorBoundary>
                    );
                    case 'timeline': return <ComponentErrorBoundary name="Timeline"><Timeline /></ComponentErrorBoundary>;
                    case 'outliner': return <ComponentErrorBoundary name="Outliner"><Outliner /></ComponentErrorBoundary>;
                    case 'inspector': return <ComponentErrorBoundary name="Inspector"><Inspector /></ComponentErrorBoundary>;
                    default: return <div className="h-full bg-[#1e1e1e]">Not found</div>;
                  }
                } catch (e) {
                  Logger.error('Layout', 'Error rendering component', e);
                  return <div className="h-full bg-[#1e1e1e] p-4 text-red-500">Error rendering {subNode.getComponent()}</div>;
                }
              }} 
            />
          </div>
        );
      case 'inspector':
        return <ComponentErrorBoundary name="Inspector"><Inspector /></ComponentErrorBoundary>;
      default:
        return <div>Component not found</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-950">
      <GlobalShortcutManager 
        getActiveMode={() => activeModeRef.current}
        onSave={handleSaveProject} 
        onSaveAs={handleSaveProjectAs} 
      />
      <TitleBar />
      <GlobalMenuBar 
        onNewProject={handleNewProject}
        onLoadProject={handleLoadProject}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onImportScript={handleImportScript}
        onOpenExportHub={() => setExportHubOpen(true)}
        onPreferences={() => useAppStore.getState().setPreferencesOpen(true)}
        onExit={() => window.ipcRenderer?.send(IPC_CHANNELS.WINDOW_CLOSE)}
      />
      <div className="flex-1 relative">
        <Layout 
          model={model} 
          factory={factory} 
          onAction={handleFlexLayoutAction}
        />
      </div>
      <Preferences />
      <ExportHub open={exportHubOpen} onClose={() => setExportHubOpen(false)} project={project} />
    </div>
  );
}

export default App;