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
import { useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { Plus, Trash2, Image as ImageIcon, GripVertical } from 'lucide-react';
import type { Panel, Scene } from '@common/models';
import { setPanelIdOnDataTransfer } from '../lib/panelTimelineDnD';
import { nativeConfirm } from '../lib/focusAfterNativeDialog';

const createDragImage = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 60;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(14, 165, 233, 0.9)'; // sky-500
    ctx.beginPath();
    ctx.roundRect(0, 0, 60, 40, 4);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Panel', 30, 20);
  }
  const img = new Image();
  img.src = canvas.toDataURL();
  return img;
};

const SortablePanel = ({ panel, sceneId, dragImg }: { panel: Panel, sceneId: string, dragImg: HTMLImageElement | null }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: panel.id });
  
  const activePanelId = useProjectStore(s => s.activePanelId);
  const setActivePanelId = useProjectStore(s => s.setActivePanelId);
  const removePanel = useProjectStore(s => s.removePanel);
  const commitHistory = useProjectStore(s => s.commitHistory);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  
  const isActive = activePanelId === panel.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`relative flex h-[90px] w-full flex-none overflow-hidden rounded border transition-colors group ${
        isActive ? 'border-blue-400 bg-blue-900' : 'border-neutral-700 bg-neutral-800 hover:border-blue-500'
      }`}
      onPointerDown={(e) => {
        e.stopPropagation();
        setActivePanelId(panel.id);
      }}
    >
      <div
        {...listeners}
        className="flex w-6 shrink-0 cursor-grab flex-col items-center justify-center border-r border-neutral-600 bg-neutral-900/90 active:cursor-grabbing hover:bg-neutral-700"
        title="Drag to reorder panels"
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
          if (dragImg) {
            e.dataTransfer.setDragImage(dragImg, 30, 20);
          }
        }}
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                if (await nativeConfirm('Delete panel?')) {
                  commitHistory();
                  removePanel(sceneId, panel.id);
                }
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

const SortableScene = ({ scene, activePanelId, activeSceneId, dragImg }: { scene: Scene; activePanelId: string | null; activeSceneId: string | null; dragImg: HTMLImageElement | null }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: scene.id });

  const addPanel = useProjectStore(s => s.addPanel);
  const removeScene = useProjectStore(s => s.removeScene);
  const reorderPanels = useProjectStore(s => s.reorderPanels);
  const commitHistory = useProjectStore(s => s.commitHistory);
  const setActiveSceneId = useProjectStore(s => s.setActiveSceneId);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleAddPanel = (e: React.MouseEvent) => {
    e.stopPropagation();
    commitHistory();
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
      commitHistory();
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
  const isSceneSelected = activeSceneId === scene.id && activePanelId === null;

  return (
    <div 
      ref={setNodeRef}
      style={style}
      onPointerDown={(e) => {
        e.stopPropagation();
        setActiveSceneId(scene.id);
      }}
      className={`flex flex-col bg-neutral-900 border rounded p-2 w-full min-w-0 shrink-0 transition-colors cursor-pointer ${
        isSceneSelected ? 'border-sky-500 ring-1 ring-sky-500/50 bg-[#16202a]' :
        sceneHasActivePanel ? 'border-blue-800/50 ring-1 ring-blue-800/30' : 'border-neutral-800 hover:border-neutral-600'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div 
          className="flex items-center gap-2 cursor-grab active:cursor-grabbing text-neutral-300"
          {...attributes} 
          {...listeners}
        >
          <GripVertical size={14} className="text-neutral-500" />
          <span className="font-bold text-sm select-none">{scene.name}</span>
        </div>
        <div className="flex gap-1">
          <button 
            onPointerDown={(e) => e.stopPropagation()} 
            onClick={handleAddPanel} 
            className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white" 
            title="Add Panel"
          >
            <Plus size={14} />
          </button>
          <button 
            onPointerDown={(e) => e.stopPropagation()} 
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                if (await nativeConfirm(`Delete ${scene.name}?`)) {
                  commitHistory();
                  removeScene(scene.id);
                }
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
          <div className="text-xs text-neutral-600 italic px-2 py-1 select-none pointer-events-none">No panels</div>
        ) : (
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={scene.panels.map(p => p.id)} strategy={verticalListSortingStrategy}>
              {scene.panels.map(panel => (
                <SortablePanel key={panel.id} panel={panel} sceneId={scene.id} dragImg={dragImg} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
};

export const Outliner = () => {
  const project = useProjectStore(s => s.project);
  const activePanelId = useProjectStore(s => s.activePanelId);
  const activeSceneId = useProjectStore(s => s.activeSceneId);
  const addScene = useProjectStore(s => s.addScene);
  const reorderScenes = useProjectStore(s => s.reorderScenes);
  const commitHistory = useProjectStore(s => s.commitHistory);
  const setActiveSceneId = useProjectStore(s => s.setActiveSceneId);
  
  const dragImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    dragImgRef.current = createDragImage();
  }, []);

  const handleAddScene = () => {
    if (!project) return;
    commitHistory();
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
      commitHistory();
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
      onPointerDown={() => setActiveSceneId(null)} 
    >
      <div className="flex shrink-0 items-center justify-between mb-4">
        <div className="flex items-center gap-2 font-bold text-neutral-200">
          <ImageIcon size={20} />
          <span>Storyboard Outliner</span>
        </div>
        <button 
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleAddScene}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm transition-colors"
        >
          <Plus size={16} /> Add Scene
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2 custom-scrollbar">
        {project.scenes.length === 0 ? (
          <div className="flex flex-1 w-full items-center justify-center text-neutral-500 italic pointer-events-none select-none">
            Click 'Add Scene' to start storyboarding.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSceneDragEnd}>
            <SortableContext items={project.scenes.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {project.scenes.map(scene => (
                <SortableScene key={scene.id} scene={scene} activePanelId={activePanelId} activeSceneId={activeSceneId} dragImg={dragImgRef.current} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
};