const tblBody = document.querySelector('#tbl tbody');
const countEl = document.querySelector('#count');
const searchEl = document.querySelector('#search');

function row(record) {
  const tr = document.createElement('tr');

  const when = new Date(record.capturedAt).toLocaleString();
  const tagsHtml = (record.tags || []).map(t => `<span class="pill">${t}</span>`).join("");

  tr.innerHTML = `
    <td class="muted">${when}</td>
    <td>${escapeHtml(record.title || "")}</td>
    <td>${escapeHtml(record.channel || "")}</td>
    <td>${record.durationSeconds ?? ""}</td>
    <td>${tagsHtml}</td>
    <td><a href="${record.url}" target="_blank" rel="noopener">Open</a></td>
    <td class="mono">${record.videoId || ""}</td>
  `;
  return tr;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function render(data) {
  tblBody.innerHTML = "";
  data.forEach(r => tblBody.appendChild(row(r)));
  countEl.textContent = `${data.length} record${data.length === 1 ? "" : "s"}`;
}

async function loadAndRender() {
  const q = (searchEl.value || "").toLowerCase();
  chrome.storage.local.get({ watched: [] }, ({ watched }) => {
    let data = watched;
    if (q) {
      data = watched.filter(r =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.channel || "").toLowerCase().includes(q)
      );
    }
    render(data);
  });
}

document.querySelector('#refresh').addEventListener('click', loadAndRender);
document.querySelector('#export').addEventListener('click', async () => {
  chrome.storage.local.get({ watched: [] }, ({ watched }) => {
    const blob = new Blob([JSON.stringify(watched, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'youtube_meta_log.json' });
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  });
});
document.querySelector('#clear').addEventListener('click', async () => {
  if (!confirm("Delete all saved records?")) return;
  await chrome.storage.local.set({ watched: [] });
  await loadAndRender();
});
searchEl.addEventListener('input', loadAndRender);

// Init
loadAndRender();
