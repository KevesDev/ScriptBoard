import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

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
            
            let newFolded = value.foldedPositions
              .map((pos: number) => {
                const mapped = tr.mapping.mapResult(pos);
                return { pos: mapped.pos, deleted: mapped.deleted };
              })
              .filter((m: { pos: number, deleted: boolean }) => !m.deleted)
              .map((m: { pos: number, deleted: boolean }) => m.pos);

            if (meta?.toggle !== undefined) {
              const pos = meta.toggle;
              if (newFolded.includes(pos)) {
                newFolded = newFolded.filter((p: number) => p !== pos);
              } else {
                newFolded.push(pos);
              }
            }

            if (meta?.clear) {
              newFolded = [];
            }

            return { foldedPositions: newFolded };
          }
        },
        props: {
          decorations(state) {
            const pluginState = this.getState(state);
            const foldedPositions = pluginState ? pluginState.foldedPositions : [];
            const decos: Decoration[] = [];
            let activeFoldEnd = -1;

            state.doc.descendants((node, pos) => {
              if (node.type.name === 'sceneHeading') {
                const isFolded = foldedPositions.includes(pos);
                
                decos.push(Decoration.widget(pos + 1, (view, getPos) => {
                  const widget = document.createElement('span');
                  widget.contentEditable = 'false';
                  widget.className = `scene-fold-chevron ${isFolded ? 'folded' : ''}`;
                  widget.innerHTML = isFolded ? '▶' : '▼';
                  
                  widget.onmousedown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    let currentPos = pos;
                    if (typeof getPos === 'function') {
                      const dynamicPos = getPos();
                      if (dynamicPos !== undefined) {
                        currentPos = dynamicPos - 1;
                      }
                    }
                    const tr = view.state.tr.setMeta(screenplayFoldingKey, { toggle: currentPos });
                    view.dispatch(tr);
                  };
                  
                  return widget;
                }, { side: -1, key: `fold-widget-${pos}` }));

                if (isFolded) {
                  let nextHeadingPos = state.doc.content.size;
                  state.doc.nodesBetween(pos + node.nodeSize, state.doc.content.size, (n, p) => {
                    if (n.type.name === 'sceneHeading' && p > pos) {
                      nextHeadingPos = p;
                      return false; 
                    }
                  });
                  activeFoldEnd = nextHeadingPos;
                  
                  decos.push(Decoration.node(pos, pos + node.nodeSize, {
                    class: 'scene-heading-folded',
                  }));
                } else {
                  activeFoldEnd = -1;
                }
                return false; 
              }

              if (activeFoldEnd > -1 && pos < activeFoldEnd) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, {
                  class: 'script-folded-node',
                  style: 'display: none !important;'
                }));
                return false; 
              }
            });

            return DecorationSet.create(state.doc, decos);
          }
        }
      })
    ];
  }
});