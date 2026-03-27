import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { Plus, Trash2, Image as ImageIcon, GripVertical, FileText, ExternalLink } from 'lucide-react';
import type { Panel, Scene } from '@common/models';
import { setPanelIdOnDataTransfer } from '../lib/panelTimelineDnD';
import { getSceneScriptContext, trimBlocksForDisplay, type ScriptSceneBlock } from '../lib/scriptSceneExcerpt';
import { nativeConfirm } from '../lib/focusAfterNativeDialog';

const SortablePanel = ({ panel, sceneId }: { panel: Panel, sceneId: string }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: panel.id });
  const { removePanel } = useProjectStore();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  
  const { activePanelId, setActivePanelId } = useProjectStore();
  const isActive = activePanelId === panel.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`relative flex h-[90px] w-full flex-none overflow-hidden rounded border transition-colors group ${
        isActive ? 'border-blue-400 bg-blue-900' : 'border-neutral-700 bg-neutral-800 hover:border-blue-500'
      }`}
    >
      <div
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab flex-col items-center justify-center border-r border-neutral-600 bg-neutral-900/90 active:cursor-grabbing hover:bg-neutral-700"
        title="Drag to reorder panels"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} className="text-neutral-500" />
      </div>
      <div
        className="relative min-w-0 flex-1 cursor-grab active:cursor-grabbing"
        draggable
        title="Drag to a storyboard overlay row on the timeline"
        onDragStart={(e) => {
          setPanelIdOnDataTransfer(e.dataTransfer, panel.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onPointerDown={() => setActivePanelId(panel.id)}
      >
        <div className="absolute inset-0 bg-white">
          {panel.thumbnailBase64 ? (
            <img
              src={panel.thumbnailBase64}
              alt=""
              draggable={false}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-300">
              <ImageIcon size={24} />
            </div>
          )}
        </div>
        <div className="absolute top-0 right-0 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                if (await nativeConfirm('Delete panel?')) removePanel(sceneId, panel.id);
              })();
            }}
            className="rounded bg-red-600 p-1 text-white shadow hover:bg-red-700"
          >
            <Trash2 size={12} />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 right-0 truncate bg-black/60 p-1 text-center text-xs">
          {panel.name || `Panel ${panel.order}`}
        </div>
      </div>
    </div>
  );
};

function blockStyle(b: ScriptSceneBlock): string {
  switch (b.type) {
    case 'character':
      return 'text-[11px] font-semibold uppercase tracking-wide text-amber-200/95';
    case 'dialogue':
      return 'text-xs leading-snug text-neutral-200 pl-2 border-l-2 border-neutral-600';
    case 'parenthetical':
      return 'text-[11px] italic text-neutral-500 pl-3';
    case 'transition':
      return 'text-[10px] uppercase tracking-wider text-violet-300/90';
    case 'action':
    default:
      return 'text-xs leading-snug text-neutral-400';
  }
}

const SortableScene = ({ scene, activePanelId }: { scene: Scene; activePanelId: string | null }) => {
  const { addPanel, removeScene, reorderPanels } = useProjectStore();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: scene.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleAddPanel = () => {
    const newPanel: Panel = {
      id: crypto.randomUUID(),
      order: scene.panels.length + 1,
      duration: '2000',
      name: `Panel ${scene.panels.length + 1}`,
      layers: [{
        id: crypto.randomUUID(),
        name: 'Vector Layer',
        type: 'vector',
        opacity: 1,
        visible: true,
        locked: false,
        blendMode: 'source-over',
        strokes: []
      }]
    };
    addPanel(scene.id, newPanel);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (active.id !== over?.id) {
      const oldIndex = scene.panels.findIndex(p => p.id === active.id);
      const newIndex = scene.panels.findIndex(p => p.id === over?.id);
      
      const newPanels = arrayMove(scene.panels, oldIndex, newIndex).map((p, i) => {
        const newOrder = i + 1;
        return {
          ...p,
          order: newOrder,
          name: /^Panel \d+$/.test(p.name) ? `Panel ${newOrder}` : p.name
        };
      });
      
      reorderPanels(scene.id, newPanels);
    }
  };

  const sceneHasActivePanel = activePanelId != null && scene.panels.some((p) => p.id === activePanelId);

  // We stop propagation on pointer down for the scene drag handle to not interfere with panel drag handle
  return (
    <div 
      ref={setNodeRef}
      style={style}
      className={`flex flex-col bg-neutral-900 border rounded p-2 w-full min-w-0 shrink-0 ${
        sceneHasActivePanel ? 'border-sky-600/80 ring-1 ring-sky-500/35' : 'border-neutral-800'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div 
          className="flex items-center gap-2 cursor-grab active:cursor-grabbing text-neutral-300"
          {...attributes} 
          {...listeners}
        >
          <span className="font-bold text-sm">{scene.name}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={handleAddPanel} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white" title="Add Panel">
            <Plus size={14} />
          </button>
          <button 
            onClick={() => {
              void (async () => {
                if (await nativeConfirm(`Delete ${scene.name}?`)) removeScene(scene.id);
              })();
            }} 
            className="p-1 hover:bg-red-900 rounded text-neutral-400 hover:text-red-400" 
            title="Delete Scene"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2">
        {scene.panels.length === 0 ? (
          <div className="text-xs text-neutral-600 italic px-2 py-1">No panels</div>
        ) : (
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={scene.panels.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {scene.panels.map(panel => (
                <SortablePanel key={panel.id} panel={panel} sceneId={scene.id} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
};

export const Outliner = () => {
  const { project, addScene, reorderScenes, activePanelId, setActiveScriptPageId } = useProjectStore();

  const panelScriptContext = useMemo(() => {
    if (!project || !activePanelId) return null;
    const sorted = [...project.scenes].sort((a, b) => a.order - b.order);
    for (let i = 0; i < sorted.length; i++) {
      const sc = sorted[i]!;
      if (!sc.panels.some((p) => p.id === activePanelId)) continue;
      return getSceneScriptContext(
        project,
        sc.name,
        i,
        sc.id,
        sc.panels.map((p) => p.id),
      );
    }
    return null;
  }, [project, activePanelId]);

  const displayBlocks = useMemo(
    () => (panelScriptContext ? trimBlocksForDisplay(panelScriptContext.blocks, 28) : []),
    [panelScriptContext],
  );

  const handleAddScene = () => {
    if (!project) return;
    const newScene: Scene = {
      id: crypto.randomUUID(),
      name: `Scene ${project.scenes.length + 1}`,
      order: project.scenes.length + 1,
      panels: []
    };
    addScene(newScene);
  };

  const handleSceneDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (active.id !== over?.id && project) {
      const oldIndex = project.scenes.findIndex(s => s.id === active.id);
      const newIndex = project.scenes.findIndex(s => s.id === over?.id);
      
      const newScenes = arrayMove(project.scenes, oldIndex, newIndex).map((s, i) => ({
        ...s,
        order: i + 1,
        name: /^Scene \d+$/.test(s.name) ? `Scene ${i + 1}` : s.name
      }));
      
      reorderScenes(newScenes);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!project) return <div className="p-4 text-neutral-500">No project loaded.</div>;

  return (
    <div
      className="flex flex-col h-full w-full bg-neutral-950 p-4"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between mb-4">
        <div className="flex items-center gap-2 font-bold text-neutral-200">
          <ImageIcon size={20} />
          <span>Storyboard Outliner</span>
        </div>
        <button 
          onClick={handleAddScene}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm transition-colors"
        >
          <Plus size={16} /> Add Scene
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
        {activePanelId && (
          <div className="shrink-0 rounded border border-neutral-700 bg-neutral-900/90 p-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-400">
              <FileText size={14} className="shrink-0 opacity-90" />
              Script for this scene
            </div>
            {panelScriptContext ? (
              <>
                <div className="mb-2 border-b border-neutral-800 pb-2 font-mono text-[11px] font-medium leading-snug text-neutral-100">
                  {panelScriptContext.heading}
                </div>
                <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                  {displayBlocks.length === 0 ? (
                    <p className="text-xs italic text-neutral-500">This scene has no action or dialogue blocks yet.</p>
                  ) : (
                    displayBlocks.map((b, idx) => (
                      <div key={`${idx}-${b.type}-${b.text.slice(0, 40)}`} className={blockStyle(b)}>
                        {b.text}
                      </div>
                    ))
                  )}
                </div>
                {panelScriptContext.blocks.length > displayBlocks.length ? (
                  <p className="mt-2 text-[10px] text-neutral-500">
                    Showing {displayBlocks.length} of {panelScriptContext.blocks.length} blocks.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded border border-neutral-600 bg-neutral-800 py-1.5 text-[11px] font-medium text-sky-300 transition-colors hover:border-sky-600 hover:bg-neutral-700"
                  onClick={() => setActiveScriptPageId(panelScriptContext.sourcePageId)}
                >
                  <ExternalLink size={12} />
                  Open “{panelScriptContext.sourcePageName}” in script editor
                </button>
              </>
            ) : (
              <div className="space-y-2 text-xs leading-relaxed text-neutral-500">
                <p>
                  No screenplay slice matched this storyboard scene. Match is by scene heading text (or scene order), or
                  link your script page in the Inspector.
                </p>
              </div>
            )}
          </div>
        )}

        {project.scenes.length === 0 ? (
          <div className="flex flex-1 w-full items-center justify-center text-neutral-500 italic">
            Click 'Add Scene' to start storyboarding.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSceneDragEnd}>
            <SortableContext items={project.scenes.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {project.scenes.map(scene => (
                <SortableScene key={scene.id} scene={scene} activePanelId={activePanelId} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
};
