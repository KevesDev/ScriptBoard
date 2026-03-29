import React from 'react';
import { ImageIcon, Clapperboard, User, Parentheses, MessageSquare, ChevronsRight } from 'lucide-react';
import { useAppStore } from '../store/appStore';

const LineTypeButton = ({ editor, type, icon, title, label }: { editor: any, type: string, icon: React.ReactNode, title: string, label: string }) => {
  const isActive = editor?.isActive(type);
  
  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault(); 
        if (editor) {
          editor.commands.focus();
          editor.commands.setNode(type);
        }
      }}
      className={`w-full py-2 transition-all flex flex-col items-center justify-center gap-1 border-l-4 ${
        isActive 
          ? 'bg-[#444] border-blue-500 text-white shadow-inner' 
          : 'border-transparent text-[#9ca3af] hover:bg-[#444] hover:text-white'
      }`}
      title={title}
    >
      <div className="opacity-80">{icon}</div>
      <span className="text-[10px] font-medium tracking-wide">{label}</span>
    </button>
  );
};

export const ScriptLeftToolbar = ({ editor }: { editor: any }) => {
  const { preferences } = useAppStore();

  return (
    <div className="w-[72px] shrink-0 bg-[#323232] border-r border-black flex flex-col items-center py-4 gap-4 z-10 text-[#d1d5db]">
      <LineTypeButton editor={editor} type="sceneHeading" icon={<ImageIcon size={20} strokeWidth={1.5} />} title={`Scene (${(preferences.shortcuts.scriptScene || 'ctrl+1').toUpperCase()})`} label="Scene" />
      <LineTypeButton editor={editor} type="action" icon={<Clapperboard size={20} strokeWidth={1.5} />} title={`Action (${(preferences.shortcuts.scriptAction || 'ctrl+2').toUpperCase()})`} label="Action" />
      <LineTypeButton editor={editor} type="character" icon={<User size={20} strokeWidth={1.5} />} title={`Character (${(preferences.shortcuts.scriptCharacter || 'ctrl+3').toUpperCase()})`} label="Character" />
      <LineTypeButton editor={editor} type="parenthetical" icon={<Parentheses size={20} strokeWidth={1.5} />} title={`Parenthetical (${(preferences.shortcuts.scriptParenthetical || 'ctrl+4').toUpperCase()})`} label="Parens" />
      <LineTypeButton editor={editor} type="dialogue" icon={<MessageSquare size={20} strokeWidth={1.5} />} title={`Dialogue (${(preferences.shortcuts.scriptDialogue || 'ctrl+5').toUpperCase()})`} label="Dialogue" />
      <LineTypeButton editor={editor} type="transition" icon={<ChevronsRight size={20} strokeWidth={1.5} />} title={`Transition (${(preferences.shortcuts.scriptTransition || 'ctrl+6').toUpperCase()})`} label="Transition" />
    </div>
  );
};