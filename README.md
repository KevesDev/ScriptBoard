# ScriptBoard

A unified desktop application for animation and film professionals that combines storyboard creation with structured scriptwriting.

## Overview

ScriptBoard is a standalone desktop application designed to streamline the creative workflow for screenwriters and storyboard artists. It integrates professional-grade storyboarding tools with a rich-text screenplay editor into a single project file, enabling seamless cross-referencing between script elements and visual panels.

## Features

### Storyboarding Module
- Full-featured drawing canvas with support for multiple layers per panel
- Professional drawing tools including brushes, pencils, erasers, shapes, fill bucket, and text
- Advanced layer management with blend modes, locking, hiding, and opacity controls
- Drag-and-drop scene and panel organization with automatic renumbering
- Pressure-sensitive pen and tablet input support (Windows Ink, Wacom, Huion)
- Onion skinning for visual continuity between panels
- Color management with color wheel, eyedropper, and custom palettes
- Scene and project export to PNG files

### Scripting Module
- Rich-text editor with support for bold, italic, colors, and lists
- Structured directory organization with default folders (Characters, World Building, Story Structure, Drafts)
- Drag-and-drop folder and page management
- Built-in spellcheck and autocomplete
- Semantic screenplay formatting with support for Scene Headings, Action, Character, Dialogue, Parenthetical, and Transition elements
- Industry-standard screenplay import/export (Fountain format)

### Integration and Linking
- Bidirectional linking between script elements and storyboard panels
- Visual indicators showing associated script content and storyboard references
- Drag-and-drop linking between script pages and storyboard scenes
- Granular linking of specific dialogue and action blocks to individual panels

## Technical Stack

- Core Language: TypeScript
- Desktop Framework: Electron (cross-platform native standalone executables)
- UI Framework: React with Tailwind CSS
- Drawing Engine: HTML5 Canvas / WebGL with Konva.js and PixiJS
- Rich Text: TipTap
- State Management: Zustand
- Layout Manager: FlexLayout React
- Audio Waveform: WaveSurfer.js
- Graphics: ReactFlow, Perfect Freehand, D3 Contour

## Project Structure
