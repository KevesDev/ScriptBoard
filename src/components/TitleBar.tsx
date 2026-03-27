import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { IPC_CHANNELS } from '@common/ipc';

export const TitleBar: React.FC = () => {
  const handleMinimize = () => window.ipcRenderer?.send(IPC_CHANNELS.WINDOW_MINIMIZE);
  const handleMaximize = () => window.ipcRenderer?.send(IPC_CHANNELS.WINDOW_MAXIMIZE);
  const handleClose = () => window.ipcRenderer?.send(IPC_CHANNELS.WINDOW_CLOSE);

  return (
    <div className="flex justify-between items-center bg-neutral-900 text-neutral-400 h-8 w-full shrink-0 select-none z-50 border-b border-neutral-800 drag-region">
      <div className="flex items-center px-4">
        <span className="text-xs font-semibold tracking-wider text-neutral-300">ScriptBoard</span>
      </div>
      
      <div className="flex h-full">
        <button 
          onClick={handleMinimize}
          className="px-4 hover:bg-neutral-800 transition-colors h-full flex items-center justify-center no-drag-region cursor-pointer"
        >
          <Minus size={16} />
        </button>
        <button 
          onClick={handleMaximize}
          className="px-4 hover:bg-neutral-800 transition-colors h-full flex items-center justify-center no-drag-region cursor-pointer"
        >
          <Square size={14} />
        </button>
        <button 
          onClick={handleClose}
          className="px-4 hover:bg-red-600 hover:text-white transition-colors h-full flex items-center justify-center no-drag-region cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
