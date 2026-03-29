import React, { useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useAppStore, defaultBrushes } from '../../store/appStore';
import { 
  Pen, Eraser, Undo, Redo, Layers as LayersIcon, 
  Plus, Trash2, MousePointer2, PaintBucket, 
  Minus, Square, Circle, Settings2, Palette,
  Brush, Pencil, PenTool, ZoomIn, ZoomOut, Maximize,
  Eye, EyeOff, ChevronUp, ChevronDown, Pipette,
  Video, PanelRightClose, PanelRightOpen, ChevronRight
} from 'lucide-react';
import type { Layer, BrushConfig } from '@common/models';

export type ToolType = 'pen' | 'eraser' | 'select' | 'line' | 'rectangle' | 'ellipse' | 'eyedropper' | 'paintbucket';
export type BrushPreset = 'solid' | 'pencil' | 'marker' | string;
export type BucketMode = 'layer' | 'all'; 

// --- SHARED UI COMPONENTS ---
const ToolButton = ({ icon, active, onClick, onContextMenu, title }: { icon: React.ReactNode, active: boolean, onClick?: () => void, onContextMenu?: (e: React.MouseEvent) => void, title: string }) => (
  <button 
    onClick={onClick} onContextMenu={onContextMenu} title={title}
    className={`p-2.5 rounded-lg transition-all ${active ? 'bg-blue-600 text-white shadow-inner' : 'text-neutral-400 hover:bg-[#444] hover:text-white'}`}
  >
    {icon}
  </button>
);

const BrushButton = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center py-2 px-1 rounded border transition-all ${
      active ? 'bg-[#3b82f6] border-blue-400 text-white shadow-inner' : 'bg-[#222] border-black text-neutral-400 hover:bg-[#333] hover:text-neutral-200'
    }`}
  >
    {icon} <span className="text-[10px] mt-1 truncate w-full text-center">{label}</span>
  </button>
);

// --- EXPORTED PANELS ---
export const StoryboardToolbar = ({ 
  tool, setTool, activeShapeTool, setActiveShapeTool, showShapeMenu, setShowShapeMenu,
  bucketMode, setBucketMode, showBucketMenu, setShowBucketMenu
}: { 
  tool: ToolType; setTool: (t: ToolType) => void; 
  activeShapeTool: 'line'|'rectangle'|'ellipse'; setActiveShapeTool: (t: 'line'|'rectangle'|'ellipse') => void;
  showShapeMenu: boolean; setShowShapeMenu: (b: boolean) => void;
  bucketMode: BucketMode; setBucketMode: (m: BucketMode) => void;
  showBucketMenu: boolean; setShowBucketMenu: (b: boolean) => void;
}) => (
  <div className="w-14 shrink-0 bg-[#323232] border-r border-black flex flex-col items-center py-2 gap-2 shadow-xl z-10">
    <ToolButton icon={<MousePointer2 size={18} />} active={tool === 'select'} onClick={() => setTool('select')} title="Select / Move" />
    <div className="w-8 h-px bg-neutral-600 my-1"></div>
    <ToolButton icon={<Pen size={18} />} active={tool === 'pen'} onClick={() => setTool('pen')} title="Brush / Pen" />
    <ToolButton icon={<Eraser size={18} />} active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser" />
    <ToolButton icon={<Pipette size={18} />} active={tool === 'eyedropper'} onClick={() => setTool('eyedropper')} title="Eyedropper" />
    
    <div className="relative flex flex-col items-center">
      <ToolButton 
        icon={<PaintBucket size={18} />} 
        active={tool === 'paintbucket'} 
        onClick={() => { setTool('paintbucket'); setShowBucketMenu(false); }} 
        onContextMenu={(e) => { e.preventDefault(); setShowBucketMenu(!showBucketMenu); }}
        title="Fill Bucket (Right-click for options)" 
      />
      {showBucketMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowBucketMenu(false)} onContextMenu={(e) => { e.preventDefault(); setShowBucketMenu(false); }}></div>
          <div className="absolute left-full top-0 ml-2 bg-[#282828] border border-black shadow-lg rounded p-1 flex flex-col gap-1 z-50 w-32">
            <button onClick={() => { setBucketMode('layer'); setTool('paintbucket'); setShowBucketMenu(false); }} className={`px-2 py-1.5 text-xs rounded hover:bg-[#444] transition-colors text-left ${bucketMode === 'layer' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Fill within boundaries of Active Layer only">Current Layer</button>
            <button onClick={() => { setBucketMode('all'); setTool('paintbucket'); setShowBucketMenu(false); }} className={`px-2 py-1.5 text-xs rounded hover:bg-[#444] transition-colors text-left ${bucketMode === 'all' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Fill treating all visible strokes as boundaries">All Layers</button>
          </div>
        </>
      )}
    </div>

    <div className="w-8 h-px bg-neutral-600 my-1"></div>
    <div className="relative flex flex-col items-center">
      <ToolButton 
        icon={activeShapeTool === 'line' ? <Minus size={18} /> : activeShapeTool === 'rectangle' ? <Square size={18} /> : <Circle size={18} />} 
        active={['line', 'rectangle', 'ellipse'].includes(tool)} 
        onClick={() => { setTool(activeShapeTool); setShowShapeMenu(false); }} 
        onContextMenu={(e) => { e.preventDefault(); setShowShapeMenu(!showShapeMenu); }}
        title="Shapes (Right-click for options)" 
      />
      {showShapeMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowShapeMenu(false)} onContextMenu={(e) => { e.preventDefault(); setShowShapeMenu(false); }}></div>
          <div className="absolute left-full top-0 ml-2 bg-[#282828] border border-black shadow-lg rounded p-1 flex flex-col gap-1 z-50">
            <button onClick={() => { setActiveShapeTool('line'); setTool('line'); setShowShapeMenu(false); }} className={`p-2 rounded hover:bg-[#444] transition-colors ${activeShapeTool === 'line' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Line"><Minus size={18} /></button>
            <button onClick={() => { setActiveShapeTool('rectangle'); setTool('rectangle'); setShowShapeMenu(false); }} className={`p-2 rounded hover:bg-[#444] transition-colors ${activeShapeTool === 'rectangle' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Rectangle"><Square size={18} /></button>
            <button onClick={() => { setActiveShapeTool('ellipse'); setTool('ellipse'); setShowShapeMenu(false); }} className={`p-2 rounded hover:bg-[#444] transition-colors ${activeShapeTool === 'ellipse' ? 'text-blue-400 bg-[#333]' : 'text-neutral-300'}`} title="Ellipse"><Circle size={18} /></button>
          </div>
        </>
      )}
    </div>
  </div>
);

export const StoryboardTopBar = ({ 
  onionSkinEnabled, setOnionSkinEnabled, zoom, setZoom, handleZoomIn, handleZoomOut, fitToScreen,
  isSidebarOpen, setIsSidebarOpen
}: { 
  onionSkinEnabled: boolean; setOnionSkinEnabled: (b: boolean) => void;
  zoom: number; setZoom: (z: number) => void;
  handleZoomIn: () => void; handleZoomOut: () => void; fitToScreen: () => void;
  isSidebarOpen: boolean; setIsSidebarOpen: (b: boolean) => void;
}) => {
  const { undo, redo, undoStack, redoStack } = useProjectStore();
  return (
    <div className="h-10 bg-[#323232] border-b border-black flex items-center px-4 gap-4 shrink-0 shadow-md z-10">
      <div className="flex items-center gap-1 border-r border-neutral-600 pr-4">
        <button onClick={undo} disabled={undoStack.length === 0} className={`p-1.5 rounded ${undoStack.length > 0 ? 'hover:bg-neutral-600' : 'opacity-30'}`} title="Undo"><Undo size={16} /></button>
        <button onClick={redo} disabled={redoStack.length === 0} className={`p-1.5 rounded ${redoStack.length > 0 ? 'hover:bg-neutral-600' : 'opacity-30'}`} title="Redo"><Redo size={16} /></button>
      </div>
      <div className="flex items-center gap-2 border-r border-neutral-600 pr-4">
        <button onClick={() => setOnionSkinEnabled(!onionSkinEnabled)} className={`p-1.5 rounded transition-colors ${onionSkinEnabled ? 'bg-blue-600 text-white shadow-inner' : 'hover:bg-neutral-600 text-neutral-400 hover:text-white'}`} title="Onion skin (panels before/after). Configure in Preferences → Storyboard."><Video size={16} /></button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <button onClick={handleZoomOut} className="p-1.5 rounded hover:bg-neutral-600 text-neutral-300 hover:text-white" title="Zoom Out"><ZoomOut size={16} /></button>
        <input type="range" min="0.1" max="3" step="0.05" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} className="w-24 accent-blue-500" />
        <button onClick={handleZoomIn} className="p-1.5 rounded hover:bg-neutral-600 text-neutral-300 hover:text-white" title="Zoom In"><ZoomIn size={16} /></button>
        <button onClick={fitToScreen} className="p-1.5 rounded hover:bg-neutral-600 ml-1 text-neutral-400 hover:text-white" title="Fit to Screen"><Maximize size={16} /></button>
        <span className="w-10 text-right font-mono text-neutral-300">{Math.round(zoom * 100)}%</span>
      </div>
      
      <div className="flex-1" />
      
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
        className={`p-1.5 rounded transition-colors ${isSidebarOpen ? 'bg-neutral-700 text-white' : 'hover:bg-neutral-600 text-neutral-400 hover:text-white'}`} 
        title="Toggle Properties Panel"
      >
        {isSidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
    </div>
  );
};

export const StoryboardSidebar = ({
  tool, brushPreset, handleBrushPresetChange, brushSize, handleBrushSizeChange, color, handleColorChange,
  swatches, panelLayersForCanvas, activeLayerId, activePanelId, getBrushConfig
}: {
  tool: ToolType; brushPreset: BrushPreset; handleBrushPresetChange: (p: BrushPreset) => void;
  brushSize: number; handleBrushSizeChange: (s: number) => void;
  color: string; handleColorChange: (c: string) => void;
  swatches: string[]; panelLayersForCanvas: Layer[]; activeLayerId: string | null; activePanelId: string | null;
  getBrushConfig: (id?: string) => BrushConfig;
}) => {
  const { preferences, addCustomBrush, removeCustomBrush, updateCustomBrush } = useAppStore();
  const { addLayer, removeLayer, setActiveLayerId, updateLayerName, toggleLayerVisibility, setLayerOpacity, moveLayerUp, moveLayerDown, updateProjectSwatches } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Layout State for Resizable Panels
  const [toolPanelHeight, setToolPanelHeight] = useState(300);
  const [colorPanelHeight, setColorPanelHeight] = useState(160);
  const [showAdvancedBrush, setShowAdvancedBrush] = useState(false);

  const handleImportBrush = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const newBrush: BrushConfig = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^/.]+$/, "").substring(0, 12),
        textureBase64: dataUrl,
        spacing: 0.1,
        scatter: 0,
        rotationMode: 'path',
        rotationAngle: 0,
        flow: 0.5,
        pressureSize: true,
        pressureOpacity: true
      };
      addCustomBrush(newBrush);
      handleBrushPresetChange(newBrush.id);
      setShowAdvancedBrush(true); // Open settings so they can tweak it immediately
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const currentBrush = getBrushConfig(brushPreset);
  const isCustom = !defaultBrushes[brushPreset];
  const isOverriddenDefault = !!preferences.customBrushes.find(b => b.id === brushPreset) && !!defaultBrushes[brushPreset];

  return (
    <div className="w-full h-full flex flex-col bg-[#323232] text-sm overflow-hidden">
      
      {/* 1. TOOL PROPERTIES PANEL */}
      <div style={{ height: toolPanelHeight, flexBasis: toolPanelHeight }} className="flex flex-col shrink-0 overflow-hidden min-h-[60px]">
        <div className="bg-[#282828] px-3 py-1.5 text-xs font-bold text-neutral-300 flex items-center gap-2 border-b border-black shrink-0 sticky top-0 z-10 shadow-sm">
          <Settings2 size={14} /> Tool Properties
        </div>
        <div className="p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1">
          {(tool === 'pen' || tool === 'eraser') ? (
            <>
              {tool === 'pen' && (
                <div>
                  <div className="text-xs text-neutral-400 mb-2 uppercase tracking-wider font-semibold">Brushes</div>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    <BrushButton icon={<PenTool size={18} />} label="Pen" active={brushPreset === 'solid'} onClick={() => handleBrushPresetChange('solid')} />
                    <BrushButton icon={<Pencil size={18} />} label="Pencil" active={brushPreset === 'pencil'} onClick={() => handleBrushPresetChange('pencil')} />
                    <BrushButton icon={<Brush size={18} />} label="Marker" active={brushPreset === 'marker'} onClick={() => handleBrushPresetChange('marker')} />
                    <BrushButton icon={<Circle size={18} className="opacity-50 blur-[1px]" />} label="Airbrush" active={brushPreset === 'airbrush'} onClick={() => handleBrushPresetChange('airbrush')} />
                  </div>
                  
                  {preferences.customBrushes && preferences.customBrushes.length > 0 && preferences.customBrushes.some(cb => !defaultBrushes[cb.id]) && (
                    <div className="grid grid-cols-4 gap-2 border-t border-black/30 pt-2 mt-2">
                      {preferences.customBrushes.filter(cb => !defaultBrushes[cb.id]).map((cb: any) => (
                         <BrushButton 
                            key={cb.id} 
                            icon={cb.textureBase64 ? <img src={cb.textureBase64} className="w-5 h-5 object-contain invert mix-blend-screen opacity-70 pointer-events-none" /> : <PenTool size={18} />} 
                            label={cb.name.substring(0, 8)} 
                            active={brushPreset === cb.id} 
                            onClick={() => handleBrushPresetChange(cb.id)} 
                         />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className={tool === 'pen' ? "mt-1" : ""}>
                <label className="flex justify-between mb-1 text-xs text-neutral-300">
                  <span>{tool === 'eraser' ? 'Eraser Size' : 'Maximum Size'}</span> 
                  <span className="bg-[#222222] px-2 py-0.5 rounded border border-black">{brushSize} px</span>
                </label>
                <input type="range" min="1" max="100" value={brushSize} onChange={e => handleBrushSizeChange(parseInt(e.target.value))} className="w-full accent-blue-500" />
              </div>
              
              {tool === 'pen' && (
                <div className="mt-2 pt-3 border-t border-black/50 flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <button 
                      onClick={() => setShowAdvancedBrush(!showAdvancedBrush)}
                      className="text-xs text-neutral-400 uppercase tracking-wider font-semibold flex items-center gap-1 hover:text-neutral-200 transition-colors focus:outline-none"
                    >
                      {showAdvancedBrush ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Advanced Settings
                    </button>
                    {isCustom ? (
                      <button onClick={() => { removeCustomBrush(brushPreset); handleBrushPresetChange('solid'); }} className="text-red-400 hover:text-red-300 flex items-center gap-1 text-xs transition-colors"><Trash2 size={12}/> Delete</button>
                    ) : isOverriddenDefault ? (
                      <button onClick={() => { removeCustomBrush(brushPreset); }} className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-xs transition-colors"><Undo size={12}/> Reset</button>
                    ) : null}
                  </div>
                  
                  {showAdvancedBrush && (
                    <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div>
                        <label className="flex justify-between mb-1 text-[10px] text-neutral-300"><span>Spacing</span> <span className="bg-[#222] px-1 py-0.5 rounded border border-black">{Math.round(currentBrush.spacing * 100)}%</span></label>
                        <input type="range" min="1" max="200" value={Math.round(currentBrush.spacing * 100)} onChange={e => updateCustomBrush(brushPreset, { spacing: parseInt(e.target.value) / 100 })} className="w-full accent-blue-500" />
                      </div>
                      <div>
                        <label className="flex justify-between mb-1 text-[10px] text-neutral-300"><span>Scatter</span> <span className="bg-[#222] px-1 py-0.5 rounded border border-black">{Math.round(currentBrush.scatter * 100)}%</span></label>
                        <input type="range" min="0" max="200" value={Math.round(currentBrush.scatter * 100)} onChange={e => updateCustomBrush(brushPreset, { scatter: parseInt(e.target.value) / 100 })} className="w-full accent-blue-500" />
                      </div>
                      <div>
                        <label className="flex justify-between mb-1 text-[10px] text-neutral-300"><span>Flow (Opacity)</span> <span className="bg-[#222] px-1 py-0.5 rounded border border-black">{Math.round(currentBrush.flow * 100)}%</span></label>
                        <input type="range" min="1" max="100" value={Math.round(currentBrush.flow * 100)} onChange={e => updateCustomBrush(brushPreset, { flow: parseInt(e.target.value) / 100 })} className="w-full accent-blue-500" />
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <div>
                          <label className="mb-1 block text-[10px] text-neutral-300">Rotation Mode</label>
                          <select value={currentBrush.rotationMode} onChange={e => updateCustomBrush(brushPreset, { rotationMode: e.target.value as any })} className="w-full bg-[#151515] border border-neutral-700 rounded px-1.5 py-1 text-[10px] text-neutral-200 outline-none">
                            <option value="fixed">Fixed</option>
                            <option value="path">Follow Path</option>
                            <option value="random">Random</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-neutral-300">Base Angle</label>
                          <input type="number" min="-360" max="360" value={currentBrush.rotationAngle} onChange={e => updateCustomBrush(brushPreset, { rotationAngle: parseInt(e.target.value) || 0 })} className="w-full bg-[#151515] border border-neutral-700 rounded px-1.5 py-1 text-[10px] text-neutral-200 outline-none" />
                        </div>
                      </div>

                      <div className="flex gap-4 mt-1">
                        <label className="flex items-center gap-1.5 text-[10px] text-neutral-300 cursor-pointer">
                          <input type="checkbox" checked={currentBrush.pressureSize} onChange={e => updateCustomBrush(brushPreset, { pressureSize: e.target.checked })} className="accent-blue-500" /> Pressure Size
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] text-neutral-300 cursor-pointer">
                          <input type="checkbox" checked={currentBrush.pressureOpacity} onChange={e => updateCustomBrush(brushPreset, { pressureOpacity: e.target.checked })} className="accent-blue-500" /> Pressure Opacity
                        </label>
                      </div>

                      <div className="flex gap-2 mt-2">
                        <input type="file" accept="image/png, image/jpeg" ref={fileInputRef} className="hidden" onChange={handleImportBrush} />
                        <button onClick={() => fileInputRef.current?.click()} className="flex-1 text-[10px] py-1.5 bg-[#444] hover:bg-[#555] rounded border border-black text-neutral-300 transition-colors shadow-sm font-medium">Import PNG as Brush...</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-neutral-500 text-xs italic">
              {tool === 'select' ? 'Select Tool active.' : tool === 'eyedropper' ? 'Click on canvas to pick color.' : tool === 'paintbucket' ? 'Paint bucket active. Right-click toolbar for layer options.' : 'Shape tool active.'}
            </div>
          )}
        </div>
      </div>

      {/* --- HORIZONTAL SPLITTER 1 --- */}
      <div 
        className="h-1 cursor-row-resize bg-black hover:bg-blue-500 shrink-0 transition-colors z-20"
        onPointerDown={(e) => {
          const startY = e.clientY;
          const startH = toolPanelHeight;
          const onMove = (me: PointerEvent) => setToolPanelHeight(Math.max(60, startH + (me.clientY - startY)));
          const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
          window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
        }}
      />

      {/* 2. COLOUR PANEL */}
      <div style={{ height: colorPanelHeight, flexBasis: colorPanelHeight }} className="flex flex-col shrink-0 overflow-hidden min-h-[60px]">
        <div className="bg-[#282828] px-3 py-1.5 text-xs font-bold text-neutral-300 flex items-center gap-2 border-b border-black shrink-0"><Palette size={14} /> Colour</div>
        <div className="p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar flex-1">
           <div className="flex gap-4 items-start">
             <div className="w-16 h-16 rounded shadow-inner border-2 border-neutral-900 shrink-0 relative overflow-hidden">
               <div className="absolute inset-0" style={{backgroundColor: color}}></div>
               <input type="color" value={color} onChange={e => handleColorChange(e.target.value)} className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
             </div>
             <div className="flex-1 flex flex-col gap-2">
               <div className="text-xs text-neutral-400 font-mono">HEX: {color.toUpperCase()}</div>
               <button onClick={() => !swatches.includes(color) && updateProjectSwatches([...swatches, color])} className="text-xs bg-[#444444] hover:bg-[#555555] py-1 px-2 rounded border border-black transition-colors">+ Add to Swatches</button>
             </div>
           </div>
           <div>
             <div className="mb-2 text-xs text-neutral-400 uppercase tracking-wider font-semibold">Swatches</div>
             <div className="flex flex-wrap gap-1.5">
               {swatches.map((s, i) => <button key={i} onClick={() => handleColorChange(s)} className={`w-6 h-6 rounded-sm border shadow-sm hover:scale-110 transition-transform ${color === s ? 'border-white' : 'border-black'}`} style={{backgroundColor: s}} title={s} />)}
             </div>
           </div>
        </div>
      </div>

      {/* --- HORIZONTAL SPLITTER 2 --- */}
      <div 
        className="h-1 cursor-row-resize bg-black hover:bg-blue-500 shrink-0 transition-colors z-20"
        onPointerDown={(e) => {
          const startY = e.clientY;
          const startH = colorPanelHeight;
          const onMove = (me: PointerEvent) => setColorPanelHeight(Math.max(60, startH + (me.clientY - startY)));
          const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
          window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
        }}
      />

      {/* 3. LAYERS PANEL */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#2a2a2a] overflow-hidden">
        <div className="bg-[#282828] px-3 py-1.5 text-xs font-bold text-neutral-300 flex justify-between items-center border-b border-black shadow-sm shrink-0">
          <div className="flex items-center gap-2"><LayersIcon size={14} /> Layers</div>
          <div className="flex items-center gap-1">
            <button onClick={() => activePanelId && addLayer(activePanelId, 'vector')} className="p-1 hover:bg-[#444] rounded transition-colors text-neutral-400 hover:text-white flex items-center gap-1" title="Add Vector Layer"><Plus size={14} /> V</button>
            <button onClick={() => activePanelId && addLayer(activePanelId, 'raster')} className="p-1 hover:bg-[#444] rounded transition-colors text-neutral-400 hover:text-white flex items-center gap-1" title="Add Raster Layer"><Plus size={14} /> R</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1">
          {panelLayersForCanvas.length === 0 && (<div className="text-xs text-neutral-500 italic text-center mt-4">No layers. Click + to add.</div>)}
          {[...panelLayersForCanvas].reverse().map((layer, index, array) => (
            <div key={layer.id} onClick={() => setActiveLayerId(layer.id)} className={`group flex flex-col gap-1 px-2 py-2 text-xs rounded cursor-pointer border transition-colors ${activeLayerId === layer.id ? 'bg-[#3b82f6] border-blue-400' : 'bg-[#333333] border-transparent hover:bg-[#404040]'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button onClick={(e) => { e.stopPropagation(); activePanelId && toggleLayerVisibility(activePanelId, layer.id); }} className={`hover:text-white ${layer.visible ? (activeLayerId === layer.id ? 'text-white' : 'text-neutral-300') : (activeLayerId === layer.id ? 'text-blue-300' : 'text-neutral-600')}`}>
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <input type="text" value={layer.name} onChange={(e) => activePanelId && updateLayerName(activePanelId, layer.id, e.target.value)} onDoubleClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).readOnly = false; (e.target as HTMLInputElement).select(); }} onBlur={(e) => { (e.target as HTMLInputElement).readOnly = true; }} readOnly className={`bg-transparent border-none outline-none flex-1 min-w-0 font-medium cursor-pointer focus:cursor-text focus:bg-white/10 focus:px-1 rounded ${activeLayerId === layer.id ? 'text-white' : 'text-neutral-300'} ${!layer.visible && 'italic opacity-60'}`} />
                </div>
                <div className={`flex items-center gap-1 ${activeLayerId === layer.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button onClick={(e) => { e.stopPropagation(); activePanelId && moveLayerUp(activePanelId, layer.id); }} disabled={index === 0} className="p-0.5 hover:bg-black/20 rounded disabled:opacity-30"><ChevronUp size={14} /></button>
                  <button onClick={(e) => { e.stopPropagation(); activePanelId && moveLayerDown(activePanelId, layer.id); }} disabled={index === array.length - 1} className="p-0.5 hover:bg-black/20 rounded disabled:opacity-30"><ChevronDown size={14} /></button>
                  <button onClick={(e) => { e.stopPropagation(); activePanelId && removeLayer(activePanelId, layer.id); }} className={`p-0.5 rounded hover:bg-black/20 ${activeLayerId === layer.id ? 'text-blue-200 hover:text-white' : 'text-neutral-500 hover:text-red-400'}`}><Trash2 size={12} /></button>
                </div>
              </div>
              {activeLayerId === layer.id && (
                <div className="flex items-center gap-2 mt-1 px-1 border-t border-black/20 pt-1">
                  <span className="text-[10px] text-blue-100">Opacity:</span>
                  <input type="range" min="0" max="1" step="0.05" value={layer.opacity ?? 1} onChange={(e) => activePanelId && setLayerOpacity(activePanelId, layer.id, parseFloat(e.target.value))} onClick={(e) => e.stopPropagation()} className="flex-1 h-1 bg-black/30 rounded-lg appearance-none cursor-pointer" />
                  <span className="text-[10px] text-blue-100 w-8 text-right font-mono">{Math.round((layer.opacity ?? 1) * 100)}%</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};