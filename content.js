// content.js — YouTube Meta Logger (watch + Shorts)
// - Saves to chrome.storage.local
// - Auto-exports via background service worker (downloads API)
// - Robust SPA navigation handling

// ---------- Utilities ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getVideoIdAndType(url = location.href) {
  const u = new URL(url);

  // Regular watch URL: .../watch?v=VIDEOID
  const v = u.searchParams.get("v");
  if (v) return { id: v, type: "watch" };

  // Shorts URL: .../shorts/VIDEOID
  const m = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{6,})/);
  if (m) return { id: m[1], type: "short" };

  return { id: null, type: null };
}

const txt = (el) => (el ? el.textContent.trim() : null);

function getMetaContent(selector) {
  const el = document.querySelector(selector);
  return el?.content?.trim() || null;
}

function isoDate() {
  return new Date().toISOString();
}

// ---------- Metadata extraction ----------
async function getMetaFromDOM() {
  const { id: videoId, type } = getVideoIdAndType();

  // Title: DOM → og:title → document.title
  const titleDom =
    document.querySelector('h1.title yt-formatted-string, #title h1, h1.ytd-watch-metadata') ||
    document.querySelector('#shorts-title') ||
    null;

  const title =
    txt(titleDom) ||
    getMetaContent('meta[property="og:title"]') ||
    document.title.replace(/\s*-\s*YouTube$/, "").trim();

  // Channel name (best-effort; YouTube DOM changes often)
  const channel =
    txt(document.querySelector('#channel-name a, ytd-channel-name a, ytd-channel-name yt-formatted-string a')) ||
    txt(document.querySelector('a.yt-simple-endpoint.style-scope.ytd-channel-name')) ||
    null;

  // Duration (sec): prefer <video>.duration, fall back to meta
  const videoEl = document.querySelector('video');
  let durationSeconds =
    Number.isFinite(videoEl?.duration) && videoEl.duration > 0
      ? Math.round(videoEl.duration)
      : null;

  if (!durationSeconds) {
    const ogDur =
      getMetaContent('meta[itemprop="duration"]') ||
      getMetaContent('meta[property="og:video:duration"]');
    const parsed = ogDur ? parseInt(ogDur, 10) : NaN;
    if (!Number.isNaN(parsed)) durationSeconds = parsed;
  }

  // Optional tags
  const tags = [...document.querySelectorAll('meta[property="og:video:tag"]')]
    .map(m => m.content)
    .filter(Boolean);

  return {
    videoId,
    kind: type, // "watch" | "short" | null
    url: location.href,
    title,
    channel,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    tags,
    capturedAt: isoDate()
  };
}

// ---------- Local storage ----------
function saveRecord(record) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ watched: [] }, ({ watched }) => {
      const key = `${record.videoId}|${record.url}`;
      if (!watched.some(r => `${r.videoId}|${r.url}` === key)) {
        watched.unshift(record);
        if (watched.length > 5000) watched.pop();
        chrome.storage.local.set({ watched }, resolve);
      } else {
        resolve();
      }
    });
  });
}

// ---------- Auto-export via background (downloads API lives there) ----------
async function maybeExport(record) {
  const { autoExport = false, exportMode = "ndjson" } =
    await chrome.storage.local.get(["autoExport", "exportMode"]);

  if (!autoExport) return;

  if (exportMode === "json-per-video") {
    // One JSON file per record
    const fname = `YouTubeMetaLogs/per-video/${record.capturedAt.slice(0,10)}_${record.videoId}.json`;
    await chrome.runtime.sendMessage({
      type: "EXPORT_FILE",
      filename: fname,
      mime: "application/json",
      contents: JSON.stringify(record, null, 2)
    });
  } else {
    // NDJSON per day (JSON Lines). We maintain a small cache per-day and overwrite same file each time.
    const day = record.capturedAt.slice(0, 10);
    const cacheKey = `ndjson_cache_${day}`;
    const { [cacheKey]: cache = "" } = await chrome.storage.local.get(cacheKey);
    const newCache = cache + JSON.stringify(record) + "\n";
    await chrome.storage.local.set({ [cacheKey]: newCache });

    const fname = `YouTubeMetaLogs/ndjson/${day}.ndjson`;
    await chrome.runtime.sendMessage({
      type: "EXPORT_FILE",
      filename: fname,
      mime: "text/plain",
      contents: newCache
    });
  }
}

// ---------- Navigation handling (SPA-friendly) ----------
let lastVideoId = null;

async function onPossibleNavigation() {
  // Let the DOM settle a bit
  await sleep(300);

  const { id } = getVideoIdAndType();
  if (!id || id === lastVideoId) return;

  // Give YouTube a moment to render metadata on watch/shorts UIs
  await sleep(500);

  const meta = await getMetaFromDOM();
  if (!meta.videoId) return;

  lastVideoId = meta.videoId;

  await saveRecord(meta);
  await maybeExport(meta);

  // Uncomment if you want console logs in the page
  // console.log("[YouTube Meta Logger] Saved:", meta);
}

function installObservers() {
  const navHandler = () => onPossibleNavigation();

  // YouTube custom events (SPA)
  window.addEventListener('yt-navigate-finish', navHandler, true);
  document.addEventListener('yt-navigate-finish', navHandler, true);
  window.addEventListener('yt-page-data-updated', navHandler, true);
  document.addEventListener('yt-page-data-updated', navHandler, true);

  // Title changes (common on SPA route changes)
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(onPossibleNavigation).observe(titleEl, { childList: true });
  }

  // DOM mutations in main area (last-resort nudge)
  const watchRoot = document.querySelector('ytd-watch-flexy') || document.body;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.addedNodes && m.addedNodes.length) { onPossibleNavigation(); break; }
    }
  }).observe(watchRoot, { childList: true, subtree: true });

  // First run (handles direct loads to watch/shorts)
  onPossibleNavigation();
}

installObservers();
