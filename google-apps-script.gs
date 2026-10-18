/**
 * Google Apps Script "Web App" that collects annotation submissions into the active Sheet.
 * Setup:
 *   1. Create a Google Sheet. Extensions -> Apps Script. Paste this. Save.
 *   2. Deploy -> New deployment -> type "Web app".
 *        Execute as: Me.   Who has access: Anyone.
 *   3. Copy the Web app URL (ends in /exec) into docs/config.js -> SHEET_ENDPOINT.
 * Each Save/Submit on the site appends one row here.
 */
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("annotations") || ss.insertSheet("annotations");
  if (sh.getLastRow() === 0) {
    sh.appendRow(["received_at","reviewer","deck_id","file","category","venue","year",
                  "title","rating","done","taxonomy_json","client_updated"]);
  }
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) {}
  sh.appendRow([new Date(), d.reviewer||"", d.deck_id||"", d.file||"", d.category||"",
                d.venue||"", d.year||"", d.title||"", d.rating||"", d.done ? "yes" : "no",
                JSON.stringify(d.taxonomy||{}), d.updated||""]);
  return ContentService.createTextOutput(JSON.stringify({ok:true}))
                       .setMimeType(ContentService.MimeType.JSON);
}
