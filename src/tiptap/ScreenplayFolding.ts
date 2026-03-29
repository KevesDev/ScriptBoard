import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

export const screenplayFoldingKey = new PluginKey('screenplayFolding');

export const ScreenplayFolding = Extension.create({
  name: 'screenplayFolding',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: screenplayFoldingKey,
        state: {
          init() {
            return { foldedPositions: [] as number[] };
          },
          apply(tr, value) {
            const meta = tr.getMeta(screenplayFoldingKey);
            
            // Map existing folded positions through the document transaction
            // This ensures if a user types text BEFORE a folded scene, the fold marker moves down accurately.
            let newFolded = value.foldedPositions
              .map((pos: number) => {
                const mapped = tr.mapping.mapResult(pos);
                return { pos: mapped.pos, deleted: mapped.deleted };
              })
              .filter((m: { pos: number, deleted: boolean }) => !m.deleted)
              .map((m: { pos: number, deleted: boolean }) => m.pos);

            // Handle the user clicking the chevron
            if (meta?.toggle !== undefined) {
              const pos = meta.toggle;
              if (newFolded.includes(pos)) {
                newFolded = newFolded.filter((p: number) => p !== pos);
              } else {
                newFolded.push(pos);
              }
            }

            // Handle forced clear (ex., if we ever need to "Expand All")
            if (meta?.clear) {
              newFolded = [];
            }

            return { foldedPositions: newFolded };
          }
        },
        props: {
          decorations(state) {
            const { foldedPositions } = this.getState(state);
            const decos: Decoration[] = [];
            let activeFoldEnd = -1;

            state.doc.descendants((node, pos) => {
              if (node.type.name === 'sceneHeading') {
                const isFolded = foldedPositions.includes(pos);
                
                // 1. Inject the Chevron Widget inside the Scene Heading
                decos.push(Decoration.widget(pos + 1, (view, getPos) => {
                  const widget = document.createElement('span');
                  widget.contentEditable = 'false';
                  widget.className = `scene-fold-chevron ${isFolded ? 'folded' : ''}`;
                  widget.innerHTML = isFolded ? '▶' : '▼';
                  
                  widget.onmousedown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // getPos() is the dynamic position of the widget. The scene heading starts exactly 1 pos earlier.
                    const currentPos = (typeof getPos === 'function' ? getPos() : pos + 1) - 1;
                    const tr = view.state.tr.setMeta(screenplayFoldingKey, { toggle: currentPos });
                    view.dispatch(tr);
                  };
                  
                  return widget;
                }, { side: -1, key: `fold-widget-${pos}` }));

                if (isFolded) {
                  // 2. Calculate the extent of the fold
                  let nextHeadingPos = state.doc.content.size;
                  state.doc.nodesBetween(pos + node.nodeSize, state.doc.content.size, (n, p) => {
                    if (n.type.name === 'sceneHeading' && p > pos) {
                      nextHeadingPos = p;
                      return false; // Stop traversing once we hit the next scene
                    }
                  });
                  activeFoldEnd = nextHeadingPos;
                  
                  // Polish later: Add a styling class to the folded heading itself
                  decos.push(Decoration.node(pos, pos + node.nodeSize, {
                    class: 'scene-heading-folded',
                  }));
                } else {
                  activeFoldEnd = -1;
                }
                return false; // Don't traverse inside scene headings
              }

              // 3. Hide all top-level nodes that fall within the active fold region
              if (activeFoldEnd > -1 && pos < activeFoldEnd) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, {
                  class: 'script-folded-node',
                  style: 'display: none !important;'
                }));
                return false; // Don't traverse children of hidden nodes
              }
            });

            return DecorationSet.create(state.doc, decos);
          }
        }
      })
    ];
  }
});