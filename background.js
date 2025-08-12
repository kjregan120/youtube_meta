// background.js — handles file export via downloads API

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "EXPORT_FILE") {
    const blob = new Blob([msg.contents], { type: msg.mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      {
        url,
        filename: msg.filename,    // e.g., YouTubeMetaLogs/ndjson/2025-08-11.ndjson
        saveAs: false,
        conflictAction: "overwrite"
      },
      () => {
        URL.revokeObjectURL(url);
        sendResponse({ ok: true });
      }
    );
    // Tell Chrome we'll respond asynchronously
    return true;
  }
});
