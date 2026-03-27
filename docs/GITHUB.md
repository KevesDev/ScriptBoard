# Git and GitHub (ScriptBoard)

## What stays out of the repo

See the root `.gitignore`: `node_modules/`, build folders (`dist/`, `dist-electron/`, `Distribution/` installers), logs, `.env` files, and editor junk. Commit **source** only; others run `npm install` and `npm run build` locally.

**Installers (`*-Setup.exe`, `*-Portable.exe`, `win-unpacked/`, etc.) must not be committed** — GitHub rejects files over 100MB. Keep them only on disk or attach to **Releases** as binary assets if you need to share them.

If GitHub Desktop still lists big `.exe` files, they were probably staged earlier. Remove them from the index (does not delete the files on disk):

```bash
git rm --cached -f Distribution/*.exe
git rm --cached -r -f Distribution/win-unpacked
```

Adjust paths if your files live under `Distribution/Distribute/` (e.g. `git rm --cached -f Distribution/Distribute/*.exe`).

## First-time setup with GitHub Desktop

1. **Initialize Git** (if this folder is not a repo yet)  
   - GitHub Desktop: **File → Add Local Repository → Create New Repository**  
   - Choose `ScriptBoard` as the folder, leave name as you like, create.  
   - Or from a terminal in the project folder: `git init`

2. **Review the first commit**  
   - In GitHub Desktop you should see all tracked files; confirm `node_modules` and `dist` are **not** listed.  
   - Summary: e.g. `Initial commit: ScriptBoard`

3. **Create the GitHub repo**  
   - GitHub Desktop: **Repository → Publish repository**  
   - Name it (e.g. `scriptboard`), choose public/private, publish.

4. **Later changes**  
   - Commit with a short message → **Push origin**.

## Command-line alternative

```bash
cd /path/to/ScriptBoard
git init
git add .
git status   # verify node_modules/ and dist/ are absent
git commit -m "Initial commit: ScriptBoard"
```

On GitHub: **New repository** (empty, no README if you already have one locally). Then:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## Optional next steps

- Add a root `README.md` describing install (`npm install`), dev (`npm run dev`), and build (`npm run build` / `npm run package`).
- Add `.env.example` if you introduce env vars (no real secrets).
- Use **Branch protection** on `main` in GitHub repo Settings if you collaborate.
