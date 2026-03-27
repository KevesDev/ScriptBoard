# ScriptBoard - Action Plan & Implementation Steps

This document outlines the phased approach to building the **ScriptBoard** application from the ground up using **TypeScript, Electron, and React**.

---

## Phase 1: Foundation & Project Setup
**Goal:** Establish the development environment, core project structure, and basic application shell.
1.  **Repository Setup:** Initialize Git repository.
2.  **Toolchain:** Initialize an Electron Forge (or Vite + Electron) project with TypeScript and React. Install Tailwind CSS for styling.
3.  **Basic Layout:** Create the main application shell using a dockable layout manager (e.g., `flexlayout-react`). Set up the Left (Directory/Outliner), Center, and Right (Inspector) panes.
4.  **Data Models:** Define the core TypeScript interfaces: `Project`, `Scene`, `Panel`, `Layer`, `ScriptPage`, `ScriptFolder`.

## Phase 2: File I/O & Auto-Save System
**Goal:** Ensure user data can be saved, loaded, and safely backed up to the local filesystem using Node.js APIs.
1.  **IPC Bridge:** Set up Inter-Process Communication (IPC) between the React frontend and Electron Node.js backend for file system access.
2.  **Project Archiver:** Implement the logic to package JSON state and image assets into a `.sbproj` (zip) file using libraries like `adm-zip` or `archiver`.
3.  **Save/Load UI:** Implement native OS File -> New, Open, Save, Save As dialogs via Electron's `dialog` module.
4.  **Auto-Save Daemon:** Implement a background timer in the main Electron process that periodically dumps the current state to a `.bak` file in the user's OS AppData directory.

## Phase 3: Scripting Engine & Directory Structure
**Goal:** Build the structured rich-text editor and the customizable file tree.
1.  **File Tree UI:** Implement a customizable sidebar tree using a React tree library (or custom state). Seed it with: Characters, World Building, Story Structure, Drafts.
2.  **Tree Operations:** Add context menus to Add, Rename, Delete, and Drag-and-Drop folders/pages.
3.  **Rich Text Editor:** Integrate **TipTap** or **Lexical**. Configure it to support Courier Prime (bundled as a local web font), bold, italic, colors, and lists.
4.  **Spellcheck & Autocomplete:** Enable Electron's native OS spellchecker. Build a custom TipTap extension for auto-complete popups.
5.  **Internal Text Linking:** Create custom TipTap nodes/marks for internal hyperlinks, allowing clicks to trigger a state change that switches the active page in the File Tree.

## Phase 4: Storyboard Core (Outliner & Data)
**Goal:** Build the structural management of scenes and panels without the complex drawing canvas yet.
1.  **Storyboard Outliner UI:** Create a grid/list view for Scenes and Panels using React.
2.  **Drag & Drop Numbering:** Implement strict sequential auto-numbering algorithms using `dnd-kit`. (e.g., inserting a panel triggers a cascade update of subsequent panel numbers).
3.  **CRUD Operations:** UI buttons and context menus to Add, Delete, Duplicate, and Move scenes and panels.
4.  **State Management:** Use Zustand or Redux to ensure changes in the outliner instantly update the global `Project` data state.

## Phase 5: Drawing Engine & Canvas (Raster & Vector)
**Goal:** Build the interactive drawing canvas with tablet support.
1.  **Canvas Rendering:** Implement a layered rendering system using **Konva.js** or a custom HTML5 Canvas implementation. Each layer in a panel is a separate canvas context or Konva Layer.
2.  **Basic Tools:** Implement Mouse-driven Brush, Eraser, Line, Shape, and Fill Bucket algorithms.
3.  **Color Management:** Build the Color Wheel UI, Eye Dropper tool (reading pixel data from canvas), and a palette for Swatches.
4.  **Tablet & Pen Integration:** Bind tools to the `PointerEvent` API (`onPointerDown`, `onPointerMove`). Read the `.pressure` property and map it dynamically to the brush stroke `lineWidth` and `globalAlpha`.
5.  **Onion Skinning:** Implement a toggle that loads the image data of the previous panel (tinted red, 30% opacity) and next panel (tinted green, 30% opacity) into the background layer of the canvas.

## Phase 6: Screenplay Editor Overhaul
**Goal:** Pivot from a generic rich-text editor to a structured, auto-formatting semantic screenplay engine.
1.  **Semantic Node Creation:** Overhaul TipTap to use strict screenplay nodes (`Scene Heading`, `Action`, `Character`, `Dialogue`, `Parenthetical`, `Transition`) instead of generic paragraphs.
2.  **Auto-Formatting Flow:** Implement keyboard event listeners to replicate industry-standard tab/enter flow (e.g., Enter on Action goes to Action, Tab goes to Character, Enter on Character goes to Dialogue).
3.  **Script Workspace UI:** Redesign the script editor to feature a left-hand "Line Types" toolbar and a dedicated Script/Storyboard Mode toggle at the top level of the application.
4.  **Auto-Sync Outliner (Cards View):** Build an engine that listens for new `Scene Heading` nodes in the script editor and automatically generates/syncs them to `Scene` objects in the Storyboard array (similar to index-card style navigation).
5.  **Script Import/Export:** Build a parser (e.g. Fountain format) to easily import and export industry-standard scripts. Importing a script with the same name updates the existing script page and syncs automatically with the Storyboard elements.

## Phase 7: Cross-Linking Integration
**Goal:** Connect the Scripting and Storyboarding halves of the application.
1.  **Linking UI:** Add a "Connections" inspector panel on the right side.
2.  **Drag & Drop Linking:** Allow dragging a script page from the tree view onto a Scene/Panel in the outliner to create a link ID association.
3.  **Granular Script-to-Panel Linking:** Implement a system to pin specific `Dialogue` or `Action` block IDs to specific Storyboard `Panel` IDs, displaying the text inside the Storyboard Inspector.
4.  **Visual Indicators:** Add UI badges to script text and storyboard thumbnails. Clicking a badge triggers an event to jump to the linked script page or canvas panel.

## Phase 8: Export & Output
**Goal:** Allow users to get their work out of the application.
1.  **Image Renderer:** Implement logic to flatten a Panel's canvas layers to a base64 string or Blob.
2.  **Scene Exporter:** Create a dialogue to select output directory and resolution. Send flattened image data to the Electron backend to write PNG files to dynamically created folders using the `fs` module.
3.  **Script Exporter:** Implement a TipTap-to-HTML and HTML-to-PDF export pipeline, or export as raw `.txt`.

## Phase 9: Polish, QA, and Optimization
**Goal:** Prepare for release.
1.  **Memory Optimization:** Implement lazy-loading. Keep only the active scene's images in memory/canvas. Unload off-screen panels to prevent VRAM/RAM bloat.
2.  **UI/UX Pass:** Polish Tailwind styles, add SVG icons, ensure dockable panes behave smoothly, customize the OS window frame.
3.  **Packaging:** Use Electron Forge or Electron Builder to compile, sign, and package the app into standalone Windows `.exe`, Mac `.dmg`, and Linux installers.