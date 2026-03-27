# ScriptBoard - Software Design Document (SDD)

## 1. Executive Summary
**ScriptBoard** is a standalone desktop application designed for animation and film professionals. It serves as a unified workspace combining a full-featured storyboard creation tool with a structured, rich-text scriptwriting environment. By integrating these two traditionally separate workflows into a single project file, ScriptBoard allows seamless cross-referencing between script elements and storyboard panels.

## 2. Technical Stack (Revised)
*Java has been replaced. While Java is powerful, achieving flawless native drawing tablet support (Windows Ink/pressure sensitivity) and building robust, Google Docs-style rich text editors from scratch in Java is notoriously difficult and clunky. The new stack leverages modern web technologies packaged as a high-performance native desktop app.*

*   **Core Language:** TypeScript
*   **Desktop Framework:** Electron (or Tauri) - Provides cross-platform native standalone executables (.exe, .dmg, .AppImage) with full operating system and file system access.
*   **UI Framework:** React with Tailwind CSS (for rapid, complex, and performant UI development, easily supporting dockable windows and custom themes).
*   **Drawing Engine:** HTML5 Canvas / WebGL (leveraging libraries like Konva.js or PixiJS for layered raster and vector graphics).
*   **Tablet/Pen Input:** Native Web Pointer Events API (`PointerEvent.pressure`, `tiltX`, `tiltY`), which perfectly interfaces with Windows Ink and Wacom/Huion drawing tablets out of the box in the Chromium engine.
*   **Rich Text Engine:** TipTap or Lexical (industry-standard, highly extensible rich text frameworks capable of complex formatting, linking, and auto-complete).
*   **Data Serialization:** JSON for project metadata and script content, packaged into a compressed archive.

## 3. Core Architecture & Data Model

### 3.1. The Project File (`.sbproj`)
A single ScriptBoard project encapsulates everything. Internally, it is an archive format (a `.zip` bundle renamed to `.sbproj`) containing:
*   `project.json`: Master metadata (resolution, settings).
*   `script/`: Directory containing JSON-serialized rich text documents and directory structure metadata.
*   `storyboard/`: Directory containing scene folders, panel metadata, and layer image data (PNGs or SVG data).
*   `links.json`: Database of bi-directional hyperlinks between script elements and storyboard elements.

### 3.2. Auto-Save & Backup System
*   **Mechanism:** A Node.js background worker process that triggers at customizable intervals (e.g., every 5 minutes or after X significant actions).
*   **Process:** Writes changes to a temporary `.sbproj.bak` file in a dedicated local AppData/Temp directory to prevent corrupting the active file during a crash.
*   **Version Control:** Option to keep the last N auto-saves.

## 4. Module Specifications

### 4.1. Storyboard Module (Visual Library & Canvas)
*   **Hierarchy:** `Project` -> `Scene` -> `Panel` -> `Layer`.
*   **Visual Library (Outliner):** 
    *   A drag-and-drop grid/list view of Scenes (using a library like `dnd-kit`).
    *   Automatic numbering (e.g., dragging Scene 4 before Scene 2 renumbers them accordingly).
    *   Expanding a Scene reveals its Panels.
    *   Panel operations: Add, Edit, Delete, Duplicate, Rearrange. Numbering is strictly maintained (Adding Panel 5 between 4 and 5 shifts old 5 to 6).
*   **Canvas & Drawing Tools (professional storyboard feature set):**
    *   **Resolution & Type:** Defined per project/panel (Raster or Vector workflows).
    *   **Layers:** Multiple layers per panel (sketch, ink, color, text) with blend modes, locking, hiding, and opacity controls.
    *   **Drawing Tools:** 
        *   **Brushes/Pencils:** Fully customizable raster brushes and vector pencils with pressure and tilt sensitivity (via Pointer API) for dynamic line thickness and opacity.
        *   **Erasers:** Hard edge and soft edge erasers, plus stroke-based erasing for vector lines.
        *   **Selection & Transform:** Lasso and Marquee selection tools; scale, rotate, and translate transformations.
        *   **Shapes:** Line, Rectangle, Ellipse, and Polyline tools.
        *   **Fill Bucket:** For flat coloring areas, with tolerance settings.
        *   **Text Tool:** For adding on-canvas notes, dialogue, or sound effects directly on the board.
    *   **Color Management:** Advanced Color Wheel, color picker (eyedropper), and a swatches panel for user-savable palettes.
    *   **Onion Skinning:** Optional overlay of previous/next panels with adjustable opacity and color-tinting (e.g., red for previous, green for next) to ensure perfect continuity between boards.
*   **Export:**
    *   Export a scene or full project to a specified directory via Node.js `fs` module.
    *   Outputs folders per scene, containing appropriately named PNG files for each panel.

### 4.2. Scripting Module (Rich Text & Organization)
*   **Text Editor (Powered by TipTap/Lexical):**
    *   Rich text capabilities: bold, italic, bullet points, font size, font color.
    *   Default Font: Classic script writing font (e.g., Courier Prime, Courier New) embedded in the app.
    *   Auto-complete dropdowns and built-in spellcheck integration (native OS spellcheck via Electron).
*   **Directory Structure (Google Docs Tabs Style):**
    *   Customizable file tree sidebar.
    *   Default Folders: `Characters`, `World Building`, `Story Structure`, `Drafts`.
    *   Operations: Add, remove, rename folders and pages. Drag to reorder.
*   **Hyperlinking System:**
    *   Highlight text -> Right Click -> "Link to Page".
    *   Allows users to click a character's name in a draft to instantly jump to the Character's profile page within the app router.

### 4.3. Integration & Linking Engine
*   **Storyboard Outliner Connection:** 
    *   A dedicated inspector pane allows linking script elements to storyboard elements.
    *   *Example 1:* Link a Character Profile page to a specific Scene (to track character appearances).
    *   *Example 2:* Highlight a specific line of dialogue/action in the script and link it directly to Panel 4 of Scene 12 using custom rich-text nodes.
    *   Visual indicators (icons/tooltips) will show when a panel has associated script text, and vice versa.

## 5. UI/UX Design (Inspiration: professional storyboard tools & long-form writing apps)
*   **Layout:** Dockable, customizable window panes (using a library like `flexlayout-react`).
*   **Modes:** 
    *   *Draw Mode:* Maximizes canvas, shows brush/color tools, timeline/panel thumbnails at the bottom.
    *   *Script Mode:* Maximizes text editor, shows directory tree on the left.
    *   *Split Mode:* Script on left, Canvas/Storyboard on right for simultaneous editing and linking.

## 6. Constraints & Considerations
*   **Performance:** Canvas rendering must be highly optimized. Electron apps can consume high RAM; large projects with hundreds of high-res panels require lazy loading of images from the local disk rather than keeping them all in memory.
*   **Native Feel:** The app must feel like a native desktop program. Custom window title bars, native OS context menus, and preventing text-selection dragging on UI elements are required.