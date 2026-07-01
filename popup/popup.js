// popup.js — popup logic

applyI18n();

document.getElementById('openLibrary').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') });
});

document.getElementById('setupBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('install/install.html') });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'METADATA_UPDATED') renderVideoList();
});

document.getElementById('reloadVideos').addEventListener('click', async () => {
  const btn = document.getElementById('reloadVideos');
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'SYNC_VIDEOS' });
    if (result?.error) {
      const list = document.getElementById('videoList');
      list.innerHTML = `<p class="empty-msg error-msg">⚠ ${result.error}</p>`;
    } else {
      await renderVideoList();
    }
  } catch (_) {
    await renderVideoList();
  }
  btn.classList.remove('loading');
  btn.disabled = false;
});

async function renderVideoList() {
  const list = document.getElementById('videoList');
  const videos = await getAllVideos();

  const completed = videos.filter((v) => v.status === 'complete');
  const downloading = videos.filter((v) => v.status === 'downloading');

  if (completed.length === 0 && downloading.length === 0) {
    list.innerHTML = `<p class="empty-msg">${chrome.i18n.getMessage('noVideos')}</p>`;
    return;
  }

  // Show downloading first, then most recent 5 completed
  const recent = [
    ...downloading,
    ...completed.sort((a, b) => b.downloadDate - a.downloadDate).slice(0, 5),
  ];

  list.innerHTML = recent
    .map((v) => {
      const duration = v.lengthSeconds
        ? formatDuration(v.lengthSeconds)
        : '';
      const sizeStr = v.fileSize ? formatSize(v.fileSize) : '';
      const badge =
        v.status === 'downloading'
          ? `<span class="downloading-badge">${chrome.i18n.getMessage('downloadingBadge')}</span>`
          : '';
      const sourceBadge = v.source === 'netflix'
        ? '<span class="source-badge netflix">Netflix</span>'
        : '<span class="source-badge youtube">YouTube</span>';

      const fallbackThumb = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22%3E%3Crect fill=%22%23333%22 width=%2216%22 height=%229%22/%3E%3C/svg%3E';

      return `
        <div class="video-item" data-video-id="${v.videoId}">
          <img src="${v.thumbnail || fallbackThumb}" alt="">
          <div class="video-info">
            <div class="video-title">${escapeHtml(v.title || v.videoId)}</div>
            <div class="video-meta">
              ${sourceBadge}
              ${duration ? `<span>${duration}</span>` : ''}
              ${sizeStr ? `<span>${sizeStr}</span>` : ''}
              ${v.qualityLabel ? `<span>${v.qualityLabel}</span>` : ''}
              ${badge}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Click → open player
  list.querySelectorAll('.video-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = item.dataset.videoId;
      if (id) {
        chrome.tabs.create({
          url: chrome.runtime.getURL(`player/player.html?video=${id}`),
        });
      }
    });
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

renderVideoList();
