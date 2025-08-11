// Utilities
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getVideoIdFromUrl(url = location.href) {
  const u = new URL(url);
  return u.searchParams.get("v");
}

function selectText(el) {
  return el ? el.textContent.trim() : null;
}

async function getMetaFromDOM() {
  // Title
  const titleEl = document.querySelector('h1.title yt-formatted-string, #title h1, h1.ytd-watch-metadata');
  const title = selectText(titleEl) || document.title.replace(" - YouTube", "").trim();

  // Channel
  const channelEl = document.querySelector('#channel-name a, ytd-channel-name a, ytd-channel-name yt-formatted-string a');
  const channel = selectText(channelEl) || null;

  // Duration (seconds) – try HTMLVideoElement first, fallback later
  const vidEl = document.querySelector('video');
  let durationSeconds = Number.isFinite(vidEl?.duration) ? Math.round(vidEl.duration) : null;
  if (!durationSeconds || durationSeconds <= 0) {
    // Try og:video:duration meta if present (not always available)
    const ogDur = document.querySelector('meta[itemprop="duration"], meta[property="og:video:duration"]')?.content;
    const parsed = ogDur ? parseInt(ogDur, 10) : NaN;
    if (!Number.isNaN(parsed)) durationSeconds = parsed;
  }

  // Tags (optional; not always present)
  const tags = [...document.querySelectorAll('meta[property="og:video:tag"]')].map(m => m.content).filter(Boolean);
  
  return {
    videoId: getVideoIdFromUrl(),
    url: location.href,
    title,
    channel,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    tags,
    capturedAt: new Date().toISOString()
  };
}

async function saveRecord(record) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ watched: [] }, ({ watched }) => {
      // De-dupe by videoId + url (in case of chapters/params)
      const key = `${record.videoId}|${record.url}`;
      const has = watched.some(r => `${r.videoId}|${r.url}` === key);
      if (!has) {
        watched.unshift(record);
        // Trim to avoid storage bloat (adjust as you like)
        if (watched.length > 2000) watched.pop();
        chrome.storage.local.set({ watched }, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

// Handle SPA navigation on YouTube
let lastVideoId = null;

async function onPossibleNavigation() {
  // Give YouTube a moment to render the new watch page elements
  await sleep(300);
  const vid = getVideoIdFromUrl();
  if (!vid || vid === lastVideoId) return;

  // Wait briefly for title/video to settle
  await sleep(500);
  const meta = await getMetaFromDOM();
  if (meta.videoId) {
    lastVideoId = meta.videoId;
    await saveRecord(meta);
    // Uncomment for debugging:
    // console.log("[YouTube Meta Logger] Saved:", meta);
  }
}

function installObservers() {
  // YouTube fires custom events during SPA navigation
  window.addEventListener('yt-navigate-finish', onPossibleNavigation);
  window.addEventListener('yt-page-data-updated', onPossibleNavigation);

  // Fallback: observe <title> changes (handles some edge cases)
  const titleEl = document.querySelector('title');
  if (titleEl) {
    const obs = new MutationObserver(onPossibleNavigation);
    obs.observe(titleEl, { childList: true });
  }

  // Initial run on first load
  onPossibleNavigation();
}

installObservers();
