// player.js — video player page logic
// Plays video from local HTTP server URL (served by yt_server.py).

applyI18n();

const video = document.getElementById('videoPlayer');
const loadingOverlay = document.getElementById('loadingOverlay');
const playerWrapper = document.getElementById('playerWrapper');

let playlistData = null;
let currentVideoId = null;
let currentPlaylistId = null;
let lastSavedTime = 0;

// ── Playback position memory ──
const POS_KEY_PREFIX = 'playbackPos_';
const resumeToast = document.getElementById('resumeToast');
const resumeTextEl = document.getElementById('resumeText');
const resumeFromStartBtn = document.getElementById('resumeFromStart');

async function savePosition() {
  if (!currentVideoId || !video.duration) return;
  const pos = { time: video.currentTime, duration: video.duration, updatedAt: Date.now() };
  try {
    await chrome.storage.local.set({ [POS_KEY_PREFIX + currentVideoId]: pos });
    lastSavedTime = video.currentTime;
  } catch (e) {}
}

async function loadPosition(videoId) {
  try {
    const result = await chrome.storage.local.get(POS_KEY_PREFIX + videoId);
    return result[POS_KEY_PREFIX + videoId] || null;
  } catch (e) {
    return null;
  }
}

async function clearPosition(videoId) {
  try {
    await chrome.storage.local.remove(POS_KEY_PREFIX + videoId);
  } catch (e) {}
}

video.addEventListener('timeupdate', () => {
  if (video.duration && Math.abs(video.currentTime - lastSavedTime) >= 5) {
    savePosition();
  }
});

video.addEventListener('pause', savePosition);
video.addEventListener('ended', () => clearPosition(currentVideoId));

window.addEventListener('pagehide', savePosition);

resumeFromStartBtn.addEventListener('click', () => {
  resumeToast.classList.add('hidden');
  video.currentTime = 0;
  video.play().catch(() => {});
});

// ── Skip buttons ──
document.getElementById('skipBack').addEventListener('click', () => {
  video.currentTime = Math.max(0, video.currentTime - 10);
});
document.getElementById('skipFwd').addEventListener('click', () => {
  video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key.toLowerCase()) {
    case 'arrowleft':
    case 'j':
      video.currentTime = Math.max(0, video.currentTime - 10);
      e.preventDefault();
      break;
    case 'arrowright':
    case 'l':
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
      e.preventDefault();
      break;
    case ' ':
    case 'k':
      if (video.paused) video.play(); else video.pause();
      e.preventDefault();
      break;
    case 'arrowup':
      video.volume = Math.min(1, video.volume + 0.1);
      e.preventDefault();
      break;
    case 'arrowdown':
      video.volume = Math.max(0, video.volume - 0.1);
      e.preventDefault();
      break;
    case 'f':
      if (document.fullscreenElement) document.exitFullscreen();
      else playerWrapper.requestFullscreen();
      e.preventDefault();
      break;
    case 'm':
      video.muted = !video.muted;
      e.preventDefault();
      break;
    default:
      if (/^[0-9]$/.test(e.key)) {
        video.currentTime = (video.duration || 0) * (parseInt(e.key) / 10);
        e.preventDefault();
      }
  }
});

// ── Init ──
(async function init() {
  const params = new URLSearchParams(location.search);
  currentVideoId = params.get('video');
  currentPlaylistId = params.get('playlist');

  if (!currentVideoId) {
    document.getElementById('videoTitle').textContent = chrome.i18n.getMessage('noVideoSpecified');
    loadingOverlay.classList.add('hidden');
    return;
  }

  if (currentPlaylistId) {
    await loadPlaylist(currentPlaylistId);
  }

  await loadVideo(currentVideoId);
})();

// ── Load video ──
async function loadVideo(videoId) {
  currentVideoId = videoId;
  loadingOverlay.classList.remove('hidden');
  resumeToast.classList.add('hidden');

  const videos = await getAllVideos();
  const meta = videos.find((v) => v.videoId === videoId);

  if (meta) {
    document.getElementById('videoTitle').textContent = meta.title || chrome.i18n.getMessage('unknown');
    document.getElementById('videoAuthor').textContent = meta.author || '';
    document.getElementById('videoQuality').textContent = meta.qualityLabel || '';
    document.getElementById('videoSize').textContent = meta.fileSize
      ? formatSize(meta.fileSize)
      : '';
    const sourceEl = document.getElementById('videoSource');
    if (sourceEl) {
      sourceEl.textContent = meta.source === 'netflix' ? 'Netflix' : 'YouTube';
    }
  }

  if (!meta?.videoUrl) {
    loadingOverlay.classList.add('hidden');
    document.getElementById('videoTitle').textContent = chrome.i18n.getMessage('videoNotFound');
    return;
  }

  // Fix legacy URLs that contain /videos/ path (bug in v2-v3)
  let videoUrl = meta.videoUrl;
  if (videoUrl && videoUrl.includes('/videos/')) {
    videoUrl = videoUrl.replace('/videos/', '/');
  }

  // Check if the HTTP server is reachable before loading video
  try {
    const healthResp = await fetch(videoUrl, { method: 'HEAD' });
    if (!healthResp.ok) {
      throw new Error(`HTTP ${healthResp.status}`);
    }
  } catch (e) {
    // Server might not be running — try to start it via native host, then retry
    let serverReady = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await chrome.runtime.sendMessage({ type: 'SYNC_VIDEOS' });
        await new Promise(r => setTimeout(r, 2000));
        const retryResp = await fetch(videoUrl, { method: 'HEAD' });
        if (retryResp.ok) { serverReady = true; break; }
      } catch (_) {}
    }
    if (!serverReady) {
      loadingOverlay.classList.add('hidden');
      document.getElementById('videoTitle').textContent =
        chrome.i18n.getMessage('serverConnectError');
      return;
    }
  }

  video.src = videoUrl;

  video.addEventListener('loadeddata', async () => {
    loadingOverlay.classList.add('hidden');

    const saved = await loadPosition(currentVideoId);
    if (saved && saved.time > 5 && saved.duration &&
        Math.abs(saved.duration - video.duration) < 2 &&
        saved.time < saved.duration - 5) {
      video.currentTime = saved.time;
      resumeTextEl.textContent = chrome.i18n.getMessage('resumeFrom', [formatDuration(Math.floor(saved.time))]);
      resumeToast.classList.remove('hidden');
      setTimeout(() => resumeToast.classList.add('hidden'), 6000);
    }
    video.play().catch(() => {});
  }, { once: true });

  video.addEventListener('error', () => {
    loadingOverlay.classList.add('hidden');
    document.getElementById('videoTitle').textContent =
      chrome.i18n.getMessage('videoLoadError');
  }, { once: true });

  if (playlistData) {
    updateSidebarHighlight();
    updatePlaylistPosition();
  }
}

// ── Playlist ──
async function loadPlaylist(playlistId) {
  const playlist = await getPlaylist(playlistId);
  if (!playlist) return;

  playlistData = playlist;

  document.getElementById('playlistControls').classList.remove('hidden');
  document.getElementById('playlistSidebar').classList.remove('hidden');

  const sidebar = document.getElementById('sidebarVideos');
  const allVideos = await getAllVideos();

  sidebar.innerHTML = (playlist.videoIds || [])
    .map((id) => {
      const v = allVideos.find((x) => x.videoId === id);
      if (!v) return '';
      const duration = v.lengthSeconds ? formatDuration(v.lengthSeconds) : '';
      return `
        <div class="sidebar-video" data-video-id="${v.videoId}">
          <img src="${v.thumbnail || ''}" alt="" class="sidebar-thumb">
          <div class="sidebar-video-info">
            <div class="sidebar-video-title">${escapeHtml(v.title || chrome.i18n.getMessage('unknown'))}</div>
            ${duration ? `<div class="sidebar-video-duration">${duration}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  sidebar.querySelectorAll('.sidebar-video').forEach((item) => {
    const img = item.querySelector('img.sidebar-thumb');
    if (img) {
      img.addEventListener('error', () => { img.style.display = 'none'; });
    }
    item.addEventListener('click', () => loadVideo(item.dataset.videoId));
  });

  document.getElementById('prevBtn').addEventListener('click', playPrevious);
  document.getElementById('nextBtn').addEventListener('click', playNext);
  video.addEventListener('ended', playNext);
}

function getCurrentIndex() {
  if (!playlistData) return -1;
  return (playlistData.videoIds || []).indexOf(currentVideoId);
}

function playPrevious() {
  const idx = getCurrentIndex();
  if (idx <= 0) return;
  loadVideo(playlistData.videoIds[idx - 1]);
}

function playNext() {
  const idx = getCurrentIndex();
  if (idx < 0 || idx >= playlistData.videoIds.length - 1) return;
  loadVideo(playlistData.videoIds[idx + 1]);
}

function updateSidebarHighlight() {
  document.querySelectorAll('.sidebar-video').forEach((el) => {
    el.classList.toggle('current', el.dataset.videoId === currentVideoId);
  });
  const current = document.querySelector('.sidebar-video.current');
  if (current) current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updatePlaylistPosition() {
  const idx = getCurrentIndex();
  const total = playlistData.videoIds.length;
  document.getElementById('playlistPosition').textContent = `${idx + 1} / ${total}`;
  document.getElementById('prevBtn').disabled = idx <= 0;
  document.getElementById('nextBtn').disabled = idx >= total - 1;
}

// ── Utilities ──
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
