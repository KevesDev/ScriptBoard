import { create } from 'zustand';
import type { Project } from '@common/models';
import { createDefaultTimeline } from '@common/projectMigrate';

import { createCoreSlice, type CoreSlice } from './slices/coreSlice';
import { createOutlinerSlice, type OutlinerSlice } from './slices/outlinerSlice';
import { createCanvasSlice, type CanvasSlice } from './slices/canvasSlice';
import { createScriptSlice, type ScriptSlice } from './slices/scriptSlice';
import { createTimelineSlice, type TimelineSlice } from './slices/timelineSlice';

export { createDefaultTimeline } from '@common/projectMigrate';

export type ProjectStoreState = CoreSlice & OutlinerSlice & CanvasSlice & ScriptSlice & TimelineSlice;

export const generateEmptyProject = (): Project => ({
  id: crypto.randomUUID(),
  name: 'Untitled Project',
  settings: {
    resolution: { width: 1920, height: 1080 },
    defaultPanelDuration: '2000',
    framerate: 24,
  },
  timeline: createDefaultTimeline(),
  rootScriptFolder: {
    id: crypto.randomUUID(),
    name: 'Root',
    type: 'folder',
    children: [
      { id: crypto.randomUUID(), name: 'Documents', type: 'folder', children: [
        { id: crypto.randomUUID(), name: 'Main Script', type: 'page', contentBase64: '' }
      ] }
    ]
  },
  scenes: [],
  links: [],
  plotTreeNodes: [],
  plotTreeEdges: [],
  swatches: [
    '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
    '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff'
  ]
});

export const useProjectStore = create<ProjectStoreState>()((...a) => ({
  ...createCoreSlice(...a),
  ...createOutlinerSlice(...a),
  ...createCanvasSlice(...a),
  ...createScriptSlice(...a),
  ...createTimelineSlice(...a),
}));