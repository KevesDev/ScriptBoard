import React from 'react';
import { useProjectStore } from '../store/projectStore';
import { TimelineProvider, useTimelineContext } from './timeline/TimelineContext';
import { TimelineTopBar, TimelineBottomBar } from './timeline/TimelineControls';
import { TimelineSidebar } from './timeline/TimelineSidebar';
import { TimelineGrid } from './timeline/TimelineGrid';
import { Loader2 } from 'lucide-react';

const TimelineLayout: React.FC = () => {
  const { exportingVideo, exportProgress } = useTimelineContext();

  return (
    <div className="relative flex h-full flex-col border-t border-black bg-[#1a1a1a] text-neutral-300 select-none">
      
      {/* THE PROGRESS LOCK: 
        Renders a full-screen overlay that physically intercepts all pointer events, 
        making it impossible to click or drag anything in the timeline while FFmpeg is running.
      */}
      {exportingVideo && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex w-96 flex-col items-center justify-center rounded-lg border border-neutral-700 bg-[#222] p-8 shadow-2xl">
            <Loader2 size={48} className="mb-4 animate-spin text-sky-400" />
            <h2 className="mb-2 text-xl font-bold text-white">Exporting Video</h2>
            <p className="mb-6 text-sm text-neutral-400">Please wait. Do not close the application.</p>
            
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div 
                className="h-full bg-sky-500 transition-all duration-300 ease-out"
                style={{ width: `${(exportProgress || 0) * 100}%` }}
              />
            </div>
            
            <div className="mt-2 w-full text-right text-xs font-mono text-neutral-500">
              {Math.round((exportProgress || 0) * 100)}%
            </div>
          </div>
        </div>
      )}

      <TimelineTopBar />
      <div className="flex min-h-0 flex-1">
        <TimelineSidebar />
        <TimelineGrid />
      </div>
      <TimelineBottomBar />
    </div>
  );
};

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
      <TimelineLayout />
    </TimelineProvider>
  );
};