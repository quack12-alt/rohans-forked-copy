/**
 * Combines the existing Form Entries -> Approved/Deleted Entries approval
 * workflow with an image-hosting fix: when a row is approved, its uploaded
 * image is copied out of Google Drive and committed into this site's
 * GitHub repo (docs/images/), and the image cell is rewritten to point at
 * the new repo-relative path instead of a Drive link.
 *
 * Why hook into approval, not form submit: the site's published CSV reads
 * from "Approved Entries", not "Form Entries" directly, so there's no
 * point syncing an image before a row is actually approved.
 *
 * Setup:
 * 1. Extensions -> Apps Script on the response Sheet. Replace the existing
 *    Code.gs contents with this whole file (it includes your existing
 *    onEdit/moveRowToApproved/moveRowToDeleted logic plus the new image
 *    sync, so nothing from the approval workflow is lost).
 * 2. Project Settings (gear icon) -> Script Properties -> add:
 *      GITHUB_TOKEN = a GitHub Personal Access Token (fine-grained, with
 *        "Contents: Read and write" permission scoped to this repo only)
 * 3. Update the CONFIG constants below if your repo/branch/paths differ.
 * 4. IMPORTANT: this file uses handleEdit, not a bare onEdit function.
 *    A bare onEdit runs as a "simple trigger" with restricted permissions
 *    that cannot make external requests (UrlFetchApp) or fully access
 *    Drive files, which silently breaks the GitHub sync while still
 *    letting the approve/reject row-move logic appear to work. To run
 *    with full permissions, add an INSTALLABLE trigger instead:
 *    Triggers (clock icon) -> Add Trigger -> Function: handleEdit,
 *    Event source: From spreadsheet, Event type: On edit -> Save, and
 *    authorize when prompted.
 * 5. Approve a test row (check the ACCEPT box) with a Drive-linked image
 *    and confirm: the file appears in the GitHub repo under
 *    docs/images/, and the image cell in "Approved Entries" now reads
 *    "images/<slug>-<row>.jpg" instead of a Drive link.
 * 6. To migrate rows that were approved before this script existed, select
 *    backfillApprovedRows from the function dropdown in the Apps Script
 *    editor toolbar and click Run once.
 */

const CONFIG = {
  githubOwner: 'quack12-alt',
  githubRepo: 'rohans-forked-copy',
  githubBranch: 'main',
  // Path inside the repo where images are committed. Site code references
  // images as "images/<file>", and the site lives in /docs, so this must
  // match: docs/images/<file>.
  repoImageDir: 'docs/images',
};

// ---------------------------------------------------------------------
// Approval workflow (existing behavior, unchanged)
// ---------------------------------------------------------------------

function handleEdit(e) {
  const sheet = e.source.getActiveSheet();
  const responseSheetName = "Form Entries";

  if (sheet.getName() !== responseSheetName) return;

  const range = e.range;
  const row = range.getRow();
  const col = range.getColumn();
  if (row === 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const acceptCol = headers.indexOf("ACCEPT") + 1;
  const rejectCol = headers.indexOf("REJECT") + 1;

  if (col !== acceptCol && col !== rejectCol) return;
  if (range.getValue() !== true) return;

  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (col === acceptCol) {
    moveRowToApproved(rowData, headers);
    sheet.deleteRow(row);
  } else if (col === rejectCol) {
    moveRowToDeleted(rowData, headers);
    sheet.deleteRow(row);
  }
}

function moveRowToApproved(rowData, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const approvedSheet = ss.getSheetByName("Approved Entries");

  const acceptIdx = headers.indexOf("ACCEPT");
  const rejectIdx = headers.indexOf("REJECT");

  const cleanedHeaders = headers.filter((_, i) => i !== acceptIdx && i !== rejectIdx);
  const cleanedRow = rowData.filter((_, i) => i !== acceptIdx && i !== rejectIdx);

  approvedSheet.appendRow(cleanedRow);

  // New: sync the just-approved row's image to GitHub.
  const newRow = approvedSheet.getLastRow();
  migrateRowImage(approvedSheet, cleanedHeaders, newRow);
}

function moveRowToDeleted(rowData, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const deletedSheet = ss.getSheetByName("Deleted Entries");

  const acceptIdx = headers.indexOf("ACCEPT");
  const rejectIdx = headers.indexOf("REJECT");

  const cleanedRow = rowData.filter((_, i) => i !== acceptIdx && i !== rejectIdx);

  deletedSheet.appendRow(cleanedRow);
}

// ---------------------------------------------------------------------
// Image sync (new)
// ---------------------------------------------------------------------

/**
 * One-time migration for rows already sitting in "Approved Entries" before
 * this script existed. Run manually from the Apps Script editor (select
 * this function, click Run). Safe to re-run: rows already on a
 * repo-relative "images/..." path are skipped since migrateRowImage only
 * acts on Drive links.
 */
function backfillApprovedRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Approved Entries");
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  for (let row = 2; row <= lastRow; row++) {
    migrateRowImage(sheet, headers, row);
  }
}

/**
 * Shared logic: if the row's image cell holds a Drive link, copy the file
 * into the GitHub repo and rewrite the cell to the new repo-relative path.
 * No-op if the column can't be found or the cell isn't a Drive link.
 */
function migrateRowImage(sheet, headers, row) {
  const imageColIndex = headers.findIndex(h =>
    /image|logo|pic/i.test(String(h))
  );
  if (imageColIndex === -1) {
    Logger.log('No image column found; skipping.');
    return;
  }

  const imageCell = sheet.getRange(row, imageColIndex + 1);
  const rawValue = imageCell.getValue();
  if (!rawValue || typeof rawValue !== 'string') return;

  const fileId = extractDriveFileId(rawValue);
  if (!fileId) {
    Logger.log(`Row ${row}: not a Drive link, leaving as-is: ${rawValue}`);
    return;
  }

  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();

    const orgColIndex = headers.findIndex(h =>
      /organization|company|host/i.test(String(h))
    );
    const orgName = orgColIndex !== -1
      ? String(sheet.getRange(row, orgColIndex + 1).getValue())
      : 'org';

    const fileName = buildFileName(orgName, row, blob);
    const repoPath = `${CONFIG.repoImageDir}/${fileName}`;

    commitFileToGitHub(blob, repoPath);

    // Site code expects paths relative to /docs, e.g. "images/foo.jpg".
    imageCell.setValue(`images/${fileName}`);
    Logger.log(`Row ${row}: image moved to ${repoPath}`);
  } catch (err) {
    Logger.log(`Row ${row}: failed to move image - ${err}`);
  }
}

function extractDriveFileId(url) {
  const match = url.match(/(?:id=|\/d\/)([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function buildFileName(orgName, row, blob) {
  const ext = (blob.getContentType() || '').includes('png') ? 'png' : 'jpg';
  const slug = orgName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'org';
  return `${slug}-${row}.${ext}`;
}

function commitFileToGitHub(blob, repoPath) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN script property is not set.');

  const apiUrl = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${repoPath}`;
  const base64Content = Utilities.base64Encode(blob.getBytes());

  // Check whether the file already exists to grab its sha (required for
  // overwriting; omit for new files).
  let sha = null;
  const getResp = UrlFetchApp.fetch(`${apiUrl}?ref=${CONFIG.githubBranch}`, {
    method: 'get',
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  if (getResp.getResponseCode() === 200) {
    sha = JSON.parse(getResp.getContentText()).sha;
  }

  const payload = {
    message: `Add org image: ${repoPath}`,
    content: base64Content,
    branch: CONFIG.githubBranch,
  };
  if (sha) payload.sha = sha;

  const putResp = UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = putResp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub API error ${code}: ${putResp.getContentText()}`);
  }
}
