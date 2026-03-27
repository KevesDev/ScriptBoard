import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { Folder, FileText, ChevronRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { ScriptFolder, ScriptPage } from '@common/models';
import { nativeConfirm, restoreElectronWindowKeyboardFocus } from '../lib/focusAfterNativeDialog';

const TreeFolder: React.FC<{ folder: ScriptFolder; depth: number }> = ({ folder, depth }) => {
  const [isOpen, setIsOpen] = useState(depth === 0); // Root is open by default
  const { addPageToFolder, removeNode } = useProjectStore(); // We'll add these next

  const handleAddPage = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newPageName = prompt('Enter new page name:');
    if (newPageName) {
      addPageToFolder(folder.id, newPageName);
    }
  };

  return (
    <div className="w-full">
      <div 
        className="flex items-center gap-1 hover:bg-[#2b3542] py-1.5 px-2 cursor-pointer group transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <ChevronDown size={14} className="text-[#9ca3af]" /> : <ChevronRight size={14} className="text-[#9ca3af]" />}
        <Folder size={14} className="text-[#4285f4] fill-[#4285f4]/20" />
        <span className="text-[13px] font-medium select-none text-[#d1d5db] truncate tracking-wide">{folder.name}</span>
        
        {depth > 0 && (
          <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[#9ca3af]">
            <button onClick={handleAddPage} className="p-1 hover:bg-[#344252] hover:text-white rounded transition-colors" title="Add Page">
              <Plus size={12} />
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                void (async () => {
                  if (await nativeConfirm(`Delete folder ${folder.name}?`)) {
                    removeNode(folder.id);
                    window.setTimeout(() => restoreElectronWindowKeyboardFocus(), 120);
                  }
                })();
              }} 
              className="p-1 hover:bg-red-900/50 hover:text-red-400 rounded transition-colors" 
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>
      
      {isOpen && folder.children && (
        <div className="flex flex-col">
          {folder.children.map(child => 
            child.type === 'folder' 
              ? <TreeFolder key={child.id} folder={child as ScriptFolder} depth={depth + 1} />
              : <TreePage key={child.id} page={child as ScriptPage} depth={depth + 1} />
          )}
          {folder.children.length === 0 && (
             <div 
               className="text-[10px] text-[#6b7280] italic py-1.5"
               style={{ paddingLeft: `${(depth + 1) * 12 + 28}px` }}
             >
               Empty folder
             </div>
          )}
        </div>
      )}
    </div>
  );
};

const TreePage: React.FC<{ page: ScriptPage; depth: number }> = ({ page, depth }) => {
  const { activeScriptPageId, setActiveScriptPageId, removeNode } = useProjectStore();
  const isActive = activeScriptPageId === page.id;

  return (
    <div 
      className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer group transition-colors ${isActive ? 'bg-[#252f3b] border-l-2 border-[#4285f4] text-white' : 'hover:bg-[#2b3542] border-l-2 border-transparent text-[#9ca3af]'}`}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      onClick={() => setActiveScriptPageId(page.id)}
    >
      <FileText size={13} className={isActive ? 'text-[#4285f4]' : 'text-[#6b7280]'} />
      <span className={`text-[13px] select-none truncate ${isActive ? 'font-semibold text-white' : 'font-medium'}`}>{page.name}</span>
      
      <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            void (async () => {
              if (await nativeConfirm(`Delete page ${page.name}?`)) {
                removeNode(page.id);
                window.setTimeout(() => restoreElectronWindowKeyboardFocus(), 120);
              }
            })();
          }} 
          className="p-1 hover:bg-red-900/50 rounded text-[#9ca3af] hover:text-red-400 transition-colors" 
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

export const FileTree: React.FC = () => {
  const project = useProjectStore(state => state.project);
  
  if (!project) return null;

  return (
    <div className="flex flex-col h-full bg-[#1a2332] overflow-y-auto w-full pt-2 text-[#d1d5db]">
      {/* We skip rendering the actual root container, and just render its children */}
      {project.rootScriptFolder.children.map(child => 
        child.type === 'folder' 
          ? <TreeFolder key={child.id} folder={child as ScriptFolder} depth={1} />
          : <TreePage key={child.id} page={child as ScriptPage} depth={1} />
      )}
    </div>
  );
};
