import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  addEdge,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import type { Connection, NodeProps, NodeChange, EdgeChange } from 'reactflow';
import 'reactflow/dist/style.css';
import { useProjectStore } from '../store/projectStore';
import { Plus, Trash2 } from 'lucide-react';

const CardNode = ({ data, isConnectable, id }: NodeProps) => {
  const updateNodeData = (newData: { label?: string; text?: string }) => {
    const store = useProjectStore.getState();
    if (!store.project) return;
    const nodes = store.project.plotTreeNodes || [];
    const updated = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...newData } } : n));
    store.updatePlotTree(updated, store.project.plotTreeEdges || []);
  };

  return (
    <div className="bg-[#ffffff] text-black shadow-lg rounded border-2 border-transparent hover:border-blue-500 transition-colors min-w-[250px]">
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="w-3 h-3 bg-blue-500" />
      <div className="flex flex-col">
        <div className="bg-neutral-100 p-2 border-b border-neutral-200 rounded-t flex items-center justify-between">
          <input
            className="font-bold text-xs uppercase tracking-wide bg-transparent outline-none flex-1"
            value={data.label}
            onChange={(e) => updateNodeData({ label: e.target.value })}
            placeholder="CARD TITLE"
          />
          <button
            className="text-neutral-400 hover:text-red-500"
            onClick={() => {
              const store = useProjectStore.getState();
              if (!store.project) return;
              const nodes = (store.project.plotTreeNodes || []).filter((n) => n.id !== id);
              const edges = (store.project.plotTreeEdges || []).filter((e) => e.source !== id && e.target !== id);
              store.updatePlotTree(nodes, edges);
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
        <div className="p-3">
          <textarea
            className="w-full h-full min-h-[60px] text-sm bg-transparent outline-none resize-none font-mono"
            value={data.text}
            onChange={(e) => updateNodeData({ text: e.target.value })}
            placeholder="Type notes here..."
          />
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="w-3 h-3 bg-blue-500" />
    </div>
  );
};

const nodeTypes = {
  card: CardNode,
};

export const PlotTreeEditor: React.FC = () => {
  const { project, updatePlotTree } = useProjectStore();

  const nodes = useMemo(() => project?.plotTreeNodes || [], [project?.plotTreeNodes]);
  const edges = useMemo(() => project?.plotTreeEdges || [], [project?.plotTreeEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!project) return;
      const newNodes = applyNodeChanges(changes, nodes);
      updatePlotTree(newNodes as any, edges as any);
    },
    [nodes, edges, project, updatePlotTree]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!project) return;
      const newEdges = applyEdgeChanges(changes, edges);
      updatePlotTree(nodes as any, newEdges as any);
    },
    [nodes, edges, project, updatePlotTree]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!project) return;
      const newEdges = addEdge(connection, edges);
      updatePlotTree(nodes as any, newEdges as any);
    },
    [nodes, edges, project, updatePlotTree]
  );

  const addNode = () => {
    if (!project) return;
    const newNode = {
      id: crypto.randomUUID(),
      type: 'card',
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: { label: 'NEW CARD', text: '' },
    };
    updatePlotTree([...nodes, newNode] as any, edges as any);
  };

  return (
    <div className="w-full h-full bg-[#151515] relative">
      <div className="absolute top-4 left-4 z-10">
        <button
          onClick={addNode}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-sm shadow-lg transition-colors font-medium"
        >
          <Plus size={16} /> Add Card
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        className="bg-[#1e1e1e]"
      >
        <Background color="#333" gap={20} size={1} />
        <Controls className="bg-white border-none shadow-lg fill-black" />
        <MiniMap
          nodeColor={() => '#e5e7eb'}
          maskColor="rgba(0, 0, 0, 0.2)"
          style={{ backgroundColor: '#282828' }}
        />
      </ReactFlow>
    </div>
  );
};
