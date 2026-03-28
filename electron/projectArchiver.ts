import AdmZip from 'adm-zip';
import path from 'node:path';
import fs from 'fs/promises';
import type { Project } from '../common/models';
import { normalizeProject, prepareProjectForPersistence } from '../common/projectMigrate';

export class ProjectArchiver {
  /**
   * Saves the project to a .sbproj file (zip archive)
   */
  static async saveProject(project: Project, filePath: string): Promise<void> {
    try {
      const zip = new AdmZip();

      const toSave = prepareProjectForPersistence(project);
      const projectJson = JSON.stringify(toSave, null, 2);
      zip.addFile('project.json', Buffer.from(projectJson, 'utf8'));

      // If we had external assets (like images) we'd add them here
      // For now, since everything is in the project state (base64 or structural data),
      // we only need project.json.

      zip.writeZip(filePath);
    } catch (error) {
      console.error('Failed to save project:', error);
      throw new Error('Failed to save project file.');
    }
  }

  /**
   * Loads the project from a .sbproj file
   */
  static async loadProject(filePath: string): Promise<Project> {
    try {
      const zip = new AdmZip(filePath);
      
      const zipEntries = zip.getEntries();
      const projectEntry = zipEntries.find(entry => entry.entryName === 'project.json');
      
      if (!projectEntry) {
        throw new Error('Invalid project file: missing project.json');
      }

      const projectJson = zip.readAsText(projectEntry);
      const raw = JSON.parse(projectJson) as Project;

      return normalizeProject(raw);
    } catch (error) {
      console.error('Failed to load project:', error);
      throw new Error('Failed to load project file.');
    }
  }

  /**
   * Writes an automatic backup next to the main project file:
   * `MyBoard.sbproj` → `MyBoard.bak.sbproj` in the same folder.
   */
  static async autoSaveProject(project: Project, mainProjectFilePath: string): Promise<string> {
    const dir = path.dirname(mainProjectFilePath);
    const ext = path.extname(mainProjectFilePath) || '.sbproj';
    const stem = path.basename(mainProjectFilePath, ext);
    const backupPath = path.join(dir, `${stem}.bak.sbproj`);
    await fs.mkdir(dir, { recursive: true });
    await this.saveProject(project, backupPath);
    return backupPath;
  }
}