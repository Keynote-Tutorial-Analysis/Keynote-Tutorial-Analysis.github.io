// Static-site config. The big PDFs load from the PUBLIC Hugging Face dataset's raw URLs;
// the dataset must be public (or these fetches 401). Everything else is bundled under data/.
window.KB_CONFIG = {
  HF_BASE: "https://huggingface.co/datasets/ozdentarikcan/conference-slide-decks/resolve/main/",
  DATA: "data/",

  // OPTIONAL central collection: paste a Google Apps Script Web App URL (ends in /exec) to have
  // every Save/Submit auto-appended to a Google Sheet, so reviewers don't export manually.
  // Leave "" to stay export-only (localStorage + the "Export my annotations" button).
  SHEET_ENDPOINT: ""
};
