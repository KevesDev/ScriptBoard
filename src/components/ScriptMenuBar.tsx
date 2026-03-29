import React from 'react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  MessageCircle,
} from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import type { ScriptPage } from '@common/models';
import { getSceneTitlesFromStoredContent } from '../lib/scriptEditorUtils';

export const ScriptMenuBar = ({
  editor,
  allPages,
  activeScriptPageId,
  outlineItems,
}: {
  editor: any;
  allPages: ScriptPage[];
  activeScriptPageId: string | null;
  outlineItems: { id: string; title: string; pos: number }[];
}) => {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-[#323232] border-b border-black text-[#9ca3af]">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('bold') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Bold"
      >
        <Bold size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('italic') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Italic"
      >
        <Italic size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('underline') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Underline"
      >
        <UnderlineIcon size={16} />
      </button>

      <div className="w-px h-5 bg-[#444] mx-1"></div>
      
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('bulletList') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Bullet List"
      >
        <List size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('orderedList') ? 'bg-[#444] text-white shadow-inner' : ''}`}
        title="Ordered List"
      >
        <ListOrdered size={16} />
      </button>

      <div className="w-px h-5 bg-[#444] mx-1"></div>

      <input
        type="color"
        onInput={event => editor.chain().focus().setColor((event.target as HTMLInputElement).value).run()}
        value={editor.getAttributes('textStyle').color || '#000000'}
        data-testid="setColor"
        className="w-6 h-6 p-0 border-0 rounded cursor-pointer bg-transparent"
        title="Text Color"
      />
      
      <div className="w-px h-5 bg-[#444] mx-1"></div>

      <button
        onClick={() => {
          if (editor.isActive('comment')) {
            editor.chain().focus().unsetMark('comment').run();
          } else {
            const authorName = useProjectStore.getState().project?.settings?.author || 'Unknown Author';
            editor.chain().focus().setMark('comment', {
              commentId: Date.now().toString(),
              text: 'New comment...',
              author: authorName,
              timestamp: Date.now()
            }).run();
          }
        }}
        className={`p-1.5 rounded hover:bg-[#444] hover:text-white transition-colors ${editor.isActive('comment') ? 'bg-[#444] text-[#eab308] shadow-inner' : ''}`}
        title="Add/Remove Comment"
      >
        <MessageCircle size={16} />
      </button>

      <div className="flex items-center gap-1 max-w-[min(420px,40vw)]">
        <div className={`p-1.5 rounded shrink-0 transition-colors ${editor.isActive('link') ? 'bg-[#444] text-white shadow-inner' : ''}`}>
          <LinkIcon size={16} />
        </div>
        <select 
          className="bg-[#151515] border border-[#444] text-xs px-2 py-1 rounded text-neutral-300 outline-none min-w-0 flex-1 truncate"
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'unlink') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
            } else if (val.startsWith('script-card:') || val.startsWith('script-page:')) {
              editor.chain().focus().extendMarkRange('link').setLink({ href: val }).run();
            }
            e.target.value = '';
          }}
          value=""
          title="Link selection to a scene card or document"
        >
          <option value="" disabled>Link to scene…</option>
          {editor.isActive('link') && <option value="unlink">- Remove link -</option>}
          {allPages.flatMap((p) => {
            const titles =
              p.id === activeScriptPageId && outlineItems.length > 0
                ? outlineItems.map((o) => o.title)
                : getSceneTitlesFromStoredContent(p.contentBase64 || '');
            if (titles.length === 0) {
              return (
                <option key={`doc-${p.id}`} value={`script-page:${p.id}`}>
                  {p.name} (document)
                </option>
              );
            }
            return titles.map((title, idx) => (
              <option key={`${p.id}-${idx}`} value={`script-card:${p.id}:${idx}`}>
                {p.name}: {title.length > 48 ? `${title.slice(0, 48)}…` : title}
              </option>
            ));
          })}
        </select>
      </div>
    </div>
  );
};