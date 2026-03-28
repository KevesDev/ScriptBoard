import React from 'react';
import { useProjectStore } from '../store/projectStore';
import { TimelineProvider } from './timeline/TimelineContext';
import { TimelineTopBar, TimelineBottomBar } from './timeline/TimelineControls';
import { TimelineSidebar } from './timeline/TimelineSidebar';
import { TimelineGrid } from './timeline/TimelineGrid';

export const Timeline: React.FC = () => {
  const { project } = useProjectStore();
  
  if (!project?.timeline) {
    return (
      <div className="flex h-full items-center justify-center bg-[#151515] text-neutral-500">
        No project loaded.
      </div>
    );
  }

  return (
    <TimelineProvider>
      <div className="flex h-full flex-col border-t border-black bg-[#1a1a1a] text-neutral-300 select-none">
        <TimelineTopBar />
        <div className="flex min-h-0 flex-1">
          <TimelineSidebar />
          <TimelineGrid />
        </div>
        <TimelineBottomBar />
      </div>
    </TimelineProvider>
  );
};