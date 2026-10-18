# Static annotation site (GitHub Pages)

A backend-free version of the slide-deck annotation tool, hostable on `*.github.io`.
It bundles the small data (unit index, references, taxonomy) and streams the large PDFs from the
public Hugging Face dataset. Reviewer annotations are saved in the browser (`localStorage`) and
downloaded via **Export my annotations** — there is no central save (static sites can't write files).

## Files
- `index.html`, `app.js`, `styles.css` — the app
- `vendor/` — pdf.js (renders slides, with a selectable text layer)
- `config.js` — `HF_BASE` (where PDFs are fetched from) + `DATA` path
- `data/units.csv` — one row per deck-file unit (from the review tool's assignments)
- `data/refs/<deck_id>/references.csv` — merged references (main refs are shown)
- `data/taxonomy.json` — the annotation taxonomy

## Publish on GitHub Pages
1. Put this repo on GitHub (code only — the PDFs are NOT here, they live on HF).
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`,
   folder **`/docs`**. Save. Your site appears at `https://<user>.github.io/<repo>/`.
3. **Make the HF dataset public** (its Settings → change visibility) — the PDFs load from its raw
   URLs, which only work without a token when the dataset is public.
4. If your dataset path differs, edit `config.js` → `HF_BASE`.

## Central collection via Google Sheets (optional — no manual export)
So reviewers don't have to export each time, each **Save/Submit** can be auto-appended to a Google
Sheet through a Google Apps Script Web App:
1. Create a Google Sheet → **Extensions → Apps Script** → paste `google-apps-script.gs` (in this
   folder) → Save.
2. **Deploy → New deployment → Web app**; *Execute as: Me*, *Who has access: Anyone*. Copy the
   `…/exec` URL.
3. Put that URL in `config.js` → `SHEET_ENDPOINT`. Done — submissions now land in the sheet
   (columns: received_at, reviewer, deck_id, file, category, venue, year, title, rating, done,
   taxonomy_json, client_updated).

The reviewer types their **name/email** in the sidebar box (stored locally, sent with each row).
`localStorage` is still the durable copy, so a failed network send never loses work, and
**Export** remains as a backup. The POST is fire-and-forget (`text/plain`, `no-cors`) to avoid
Apps Script CORS issues — the row is written even though the page can't read the reply.

## Notes / limits
- Without a `SHEET_ENDPOINT`, there is **no central collection** — each reviewer's work stays in
  their browser and is gathered only via **Export**. (Alternatively, a Hugging Face Space running
  the Python tool gives a full server-side backend.)
- PDFs are fetched cross-origin from Hugging Face. Public HF files are served with permissive CORS,
  so this normally works; if a specific deck won't render, the **Open ↗** link still opens it.
- The "Target venues only" filter mirrors the review tool's venue filter (ACL/EMNLP/ICML/CVPR
  tutorials + all keynotes); untick it to browse everything.
