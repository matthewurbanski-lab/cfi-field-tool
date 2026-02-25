# CFI Field Tool (iPad Checklist + Logic Flow + Flight Plan)

A single-page web app designed for CFIs to run in the field on iPad (Safari).
It provides:
- Logic-based inspection checklist (answers filter solution types)
- Solution-specific flight plan builder (units: LF/SF/EA) with ArcSite object dropdowns
- Embedded cheat sheet + product-spacing placeholders you can edit
- Job Summary screen (symptoms/proof/solutions/quantities) + Print
- Export/Import of a job as JSON (for resume/transfer)

## Quick Start (Local)
Open `index.html` in a browser.

## Host on GitHub Pages
1. Create a GitHub repo (e.g. `cfi-field-tool`)
2. Upload the contents of this folder to the repo root
3. GitHub repo → Settings → Pages
4. Source: Deploy from branch → `main` / `(root)`
5. Open: https://<your-username>.github.io/<repo-name>/

## iPad Use
- Open the GitHub Pages link in Safari
- Share → Add to Home Screen (runs like an app)
- Progress autosaves in local storage; Export at the end of the inspection

## Configuration
Edit these files to match AquaGuard/Groundworks standards:
- `products.json` — product names + spacing rules + eligibility notes (displayed + used in summary)
- `arscite-objects.json` — your ArcSite object list (dropdown options inside Flight Plan items)
- `decision-tree.json` — logic questions + solution tags + default line items + units

## Export Format
Exports one JSON containing:
- Job info (address, date, homeowner, notes)
- Answers + derived tags
- Suggested solutions
- Flight plan items (with ArcSite object selection)
- Field prompts completion
