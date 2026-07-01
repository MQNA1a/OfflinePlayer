// library.js — library page logic with inline player

applyI18n();

let currentView = 'all'; // 'all', 'youtube', 'netflix', or playlist id
let allVideos = [];
let allPlaylists = [];
let selectedVideoForPlaylist = null;

// ── Player state ──
const videoEl = document.getElementById('videoPlayer');
const loadingOverlay = document.getElementById('loadingOverlay');
const playerWrapper = document.getElementById('playerWrapper');
const playerPanel = document.getElementById('playerPanel');
const videoGrid = document.getElementById('videoGrid');
const mainHeader = document.querySelector('.main-header');
const resumeToast = document.getElementById('resumeToast');
const resumeTextEl = document.getElementById('resumeText');

let currentVideoId = null;
let lastSavedTime = 0;
const POS_KEY_PREFIX = 'playbackPos_';

// ── Init ──
document.addEventListener('DOMContentLoaded', init);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'METADATA_UPDATED') {
    loadData().then(() => {
      renderPlaylists();
      renderVideos();
    });
  }
});

async function init() {
  await syncAndLoad();
  renderPlaylists();
  renderVideos();
  setupEventListeners();
  setupPlayerListeners();
}

async function syncAndLoad() {
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_VIDEOS' });
  } catch (_) {}
  await loadData();
}

async function loadData() {
  const [videosRes, playlistsRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_ALL_VIDEOS' }),
    chrome.runtime.sendMessage({ type: 'GET_PLAYLISTS' }),
  ]);
  allVideos = videosRes.videos || [];
  allPlaylists = playlistsRes.playlists || [];
}

// ── Event listeners ──
function setupEventListeners() {
  document.getElementById('reloadVideos').addEventListener('click', async () => {
    const btn = document.getElementById('reloadVideos');
    btn.classList.add('loading');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SYNC_VIDEOS' });
      if (result?.error) {
        alert(result.error);
      }
    } catch (_) {}
    await loadData();
    renderPlaylists();
    renderVideos();
    btn.classList.remove('loading');
  });

  document.getElementById('createPlaylistBtn').addEventListener('click', () => {
    document.getElementById('playlistModal').classList.remove('hidden');
    document.getElementById('playlistNameInput').focus();
  });

  document.getElementById('cancelPlaylist').addEventListener('click', () => {
    document.getElementById('playlistModal').classList.add('hidden');
    document.getElementById('playlistNameInput').value = '';
  });

  document.getElementById('confirmPlaylist').addEventListener('click', createPlaylist);

  document.getElementById('playlistNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createPlaylist();
  });

  document.getElementById('closeAddToPlaylist').addEventListener('click', () => {
    document.getElementById('addToPlaylistModal').classList.add('hidden');
    selectedVideoForPlaylist = null;
  });
}

// ── Player setup ──
function setupPlayerListeners() {
  document.getElementById('closePlayer').addEventListener('click', closePlayer);

  document.getElementById('skipBack').addEventListener('click', () => {
    videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
  });
  document.getElementById('skipFwd').addEventListener('click', () => {
    videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
  });

  document.getElementById('resumeFromStart').addEventListener('click', () => {
    resumeToast.classList.add('hidden');
    videoEl.currentTime = 0;
    videoEl.play().catch(() => {});
  });

  videoEl.addEventListener('timeupdate', () => {
    if (videoEl.duration && Math.abs(videoEl.currentTime - lastSavedTime) >= 5) {
      savePosition();
    }
  });
  videoEl.addEventListener('pause', savePosition);
  videoEl.addEventListener('ended', () => {
    clearPosition(currentVideoId);
    playNext();
  });

  document.getElementById('prevBtn').addEventListener('click', playPrevious);
  document.getElementById('nextBtn').addEventListener('click', playNext);

  document.addEventListener('keydown', (e) => {
    if (playerPanel.classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 'arrowleft':
      case 'j':
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
        e.preventDefault();
        break;
      case 'arrowright':
      case 'l':
        videoEl.currentTime = Math.min(videoEl.duration || 0, videoEl.currentTime + 10);
        e.preventDefault();
        break;
      case ' ':
      case 'k':
        if (videoEl.paused) videoEl.play(); else videoEl.pause();
        e.preventDefault();
        break;
      case 'arrowup':
        videoEl.volume = Math.min(1, videoEl.volume + 0.1);
        e.preventDefault();
        break;
      case 'arrowdown':
        videoEl.volume = Math.max(0, videoEl.volume - 0.1);
        e.preventDefault();
        break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else playerWrapper.requestFullscreen();
        e.preventDefault();
        break;
      case 'm':
        videoEl.muted = !videoEl.muted;
        e.preventDefault();
        break;
      default:
        if (/^[0-9]$/.test(e.key)) {
          videoEl.currentTime = (videoEl.duration || 0) * (parseInt(e.key) / 10);
          e.preventDefault();
        }
    }
  });

  window.addEventListener('pagehide', savePosition);
}

// ── Playback position ──
async function savePosition() {
  if (!currentVideoId || !videoEl.duration) return;
  const pos = { time: videoEl.currentTime, duration: videoEl.duration, updatedAt: Date.now() };
  try {
    await chrome.storage.local.set({ [POS_KEY_PREFIX + currentVideoId]: pos });
    lastSavedTime = videoEl.currentTime;
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

// ── Inline player ──
function openInlinePlayer(videoId) {
  videoGrid.classList.add('hidden');
  mainHeader.classList.add('hidden');
  playerPanel.classList.remove('hidden');

  // Playlist controls
  const playlistControls = document.getElementById('playlistControls');
  if (currentView !== 'all' && currentView !== 'youtube' && currentView !== 'netflix') {
    const playlist = allPlaylists.find((p) => p.id === currentView);
    if (playlist) {
      playlistControls.classList.remove('hidden');
      updatePlaylistPosition();
    } else {
      playlistControls.classList.add('hidden');
    }
  } else {
    playlistControls.classList.add('hidden');
  }

  loadVideoInline(videoId);
}

function closePlayer() {
  videoEl.pause();
  savePosition();
  playerPanel.classList.add('hidden');
  videoGrid.classList.remove('hidden');
  mainHeader.classList.remove('hidden');
}

async function loadVideoInline(videoId) {
  currentVideoId = videoId;
  loadingOverlay.classList.remove('hidden');
  resumeToast.classList.add('hidden');

  const meta = allVideos.find((v) => v.videoId === videoId);

  if (meta) {
    document.getElementById('videoTitle').textContent = meta.title || videoId;
    document.getElementById('videoAuthor').textContent = meta.author || '';
    document.getElementById('videoQuality').textContent = meta.qualityLabel || '';
    document.getElementById('videoSize').textContent = meta.fileSize ? formatSize(meta.fileSize) : '';
    document.getElementById('videoSource').textContent = meta.source === 'netflix' ? 'Netflix' : 'YouTube';
  } else {
    document.getElementById('videoTitle').textContent = videoId;
  }

  if (!meta?.videoUrl) {
    loadingOverlay.classList.add('hidden');
    document.getElementById('videoTitle').textContent = chrome.i18n.getMessage('videoNotFound');
    return;
  }

  let videoUrl = meta.videoUrl;
  if (videoUrl.includes('/videos/')) {
    videoUrl = videoUrl.replace('/videos/', '/');
  }

  try {
    const healthResp = await fetch(videoUrl, { method: 'HEAD' });
    if (!healthResp.ok) throw new Error(`HTTP ${healthResp.status}`);
  } catch (e) {
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

  videoEl.src = videoUrl;

  videoEl.addEventListener('loadeddata', async () => {
    loadingOverlay.classList.add('hidden');

    const saved = await loadPosition(currentVideoId);
    if (saved && saved.time > 5 && saved.duration &&
        Math.abs(saved.duration - videoEl.duration) < 2 &&
        saved.time < saved.duration - 5) {
      videoEl.currentTime = saved.time;
      resumeTextEl.textContent = chrome.i18n.getMessage('resumeFrom', [formatDuration(Math.floor(saved.time))]);
      resumeToast.classList.remove('hidden');
      setTimeout(() => resumeToast.classList.add('hidden'), 6000);
    }
    videoEl.play().catch(() => {});
  }, { once: true });

  videoEl.addEventListener('error', () => {
    loadingOverlay.classList.add('hidden');
    document.getElementById('videoTitle').textContent =
      chrome.i18n.getMessage('videoLoadError');
  }, { once: true });

  if (!document.getElementById('playlistControls').classList.contains('hidden')) {
    updatePlaylistPosition();
  }
}

// ── Playlist navigation ──
function getCurrentPlaylistVideoIds() {
  if (currentView === 'all' || currentView === 'youtube' || currentView === 'netflix') return null;
  const playlist = allPlaylists.find((p) => p.id === currentView);
  return playlist ? (playlist.videoIds || []) : null;
}

function playPrevious() {
  const ids = getCurrentPlaylistVideoIds();
  if (!ids) return;
  const idx = ids.indexOf(currentVideoId);
  if (idx <= 0) return;
  loadVideoInline(ids[idx - 1]);
}

function playNext() {
  const ids = getCurrentPlaylistVideoIds();
  if (!ids) return;
  const idx = ids.indexOf(currentVideoId);
  if (idx < 0 || idx >= ids.length - 1) return;
  loadVideoInline(ids[idx + 1]);
}

function updatePlaylistPosition() {
  const ids = getCurrentPlaylistVideoIds();
  if (!ids) return;
  const idx = ids.indexOf(currentVideoId);
  document.getElementById('playlistPosition').textContent = `${idx + 1} / ${ids.length}`;
  document.getElementById('prevBtn').disabled = idx <= 0;
  document.getElementById('nextBtn').disabled = idx >= ids.length - 1;
}

// ── Playlists ──
async function createPlaylist() {
  const name = document.getElementById('playlistNameInput').value.trim();
  if (!name) return;

  const res = await chrome.runtime.sendMessage({ type: 'CREATE_PLAYLIST', name });
  allPlaylists.push(res.playlist);

  document.getElementById('playlistModal').classList.add('hidden');
  document.getElementById('playlistNameInput').value = '';

  renderPlaylists();
}

function renderPlaylists() {
  const list = document.getElementById('playlistList');
  list.innerHTML = '';

  allPlaylists.forEach((pl) => {
    const item = document.createElement('div');
    item.className = 'playlist-item';
    if (currentView === pl.id) item.classList.add('active');

    item.innerHTML = `
      <span class="playlist-name">${escapeHtml(pl.name)}</span>
      <span class="playlist-count">${pl.videoIds.length}</span>
      <button class="playlist-delete" data-id="${pl.id}">×</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('playlist-delete')) return;
      currentView = pl.id;
      document.querySelectorAll('.nav-btn, .playlist-item').forEach((el) => el.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('viewTitle').textContent = pl.name;
      closePlayer();
      renderVideos();
    });

    item.querySelector('.playlist-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({ type: 'DELETE_PLAYLIST', playlistId: pl.id });
      allPlaylists = allPlaylists.filter((p) => p.id !== pl.id);
      if (currentView === pl.id) {
        currentView = 'all';
        document.querySelector('.nav-btn[data-view="all"]').classList.add('active');
        document.getElementById('viewTitle').textContent = chrome.i18n.getMessage('allVideos');
      }
      renderPlaylists();
      renderVideos();
    });

    list.appendChild(item);
  });
}

// ── Videos ──
function renderVideos() {
  const grid = document.getElementById('videoGrid');
  const countEl = document.getElementById('videoCount');

  let videos = allVideos.filter((v) => v.status === 'complete' || v.status === 'downloading');

  if (currentView === 'youtube' || currentView === 'netflix') {
    videos = videos.filter((v) => (v.source || 'youtube') === currentView);
  } else if (currentView !== 'all') {
    const playlist = allPlaylists.find((p) => p.id === currentView);
    if (playlist) {
      const ids = playlist.videoIds || [];
      videos = videos.filter((v) => ids.includes(v.videoId));
    }
  }

  countEl.textContent = `${videos.length}`;

  if (videos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3>${chrome.i18n.getMessage('noVideosTitle')}</h3>
        <p>${chrome.i18n.getMessage('noVideosDesc')}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = videos
    .sort((a, b) => b.downloadDate - a.downloadDate)
    .map((v) => {
      const duration = v.lengthSeconds ? formatDuration(v.lengthSeconds) : '';
      const size = v.fileSize ? formatSize(v.fileSize) : '';
      const status =
        v.status === 'downloading' ? `<span style="color:#1a73e8">${chrome.i18n.getMessage('downloadingBadge')}</span>` : '';
      const sourceBadge = v.source === 'netflix'
        ? '<span class="source-badge netflix">Netflix</span>'
        : '<span class="source-badge youtube">YouTube</span>';

      const fallbackThumb = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22%3E%3Crect fill=%22%23333%22 width=%2216%22 height=%229%22/%3E%3C/svg%3E';

      return `
        <div class="video-card" data-video-id="${v.videoId}">
          <div class="video-thumbnail">
            <img src="${v.thumbnail || fallbackThumb}" alt="">
            ${duration ? `<span class="video-duration">${duration}</span>` : ''}
          </div>
          <div class="video-card-body">
            <div class="video-card-title">${escapeHtml(v.title || v.videoId)}</div>
            <div class="video-card-meta">
              ${sourceBadge}
              ${v.author ? `<span>${escapeHtml(v.author)}</span>` : ''}
              ${v.qualityLabel ? `<span>${v.qualityLabel}</span>` : ''}
              ${size ? `<span>${size}</span>` : ''}
              ${status}
            </div>
            <div class="video-card-actions">
              <button class="card-action-btn" data-action="playlist" data-video-id="${v.videoId}">${chrome.i18n.getMessage('addToPlaylist')}</button>
              <button class="card-action-btn danger" data-action="delete" data-video-id="${v.videoId}">${chrome.i18n.getMessage('delete')}</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Click on card → open inline player
  grid.querySelectorAll('.video-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-action-btn')) return;
      openInlinePlayer(card.dataset.videoId);
    });
  });

  // Action buttons
  grid.querySelectorAll('.card-action-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const videoId = btn.dataset.videoId;
      if (action === 'delete') handleDelete(videoId);
      if (action === 'playlist') openAddToPlaylist(videoId);
    });
  });
}

async function handleDelete(videoId) {
  if (!confirm(chrome.i18n.getMessage('deleteConfirm'))) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_VIDEO', videoId });
  allVideos = allVideos.filter((v) => v.videoId !== videoId);
  allPlaylists.forEach((pl) => {
    pl.videoIds = (pl.videoIds || []).filter((id) => id !== videoId);
  });
  renderPlaylists();
  renderVideos();
}

async function openAddToPlaylist(videoId) {
  selectedVideoForPlaylist = videoId;
  const container = document.getElementById('playlistOptions');

  if (allPlaylists.length === 0) {
    container.innerHTML = `<p style="color:#888;padding:8px 0">${chrome.i18n.getMessage('noPlaylistsMsg')}</p>`;
  } else {
    container.innerHTML = allPlaylists
      .map((pl) => {
        const checked = (pl.videoIds || []).includes(videoId) ? 'checked' : '';
        return `
          <div class="playlist-option">
            <input type="checkbox" id="pl_${pl.id}" data-playlist-id="${pl.id}" ${checked}>
            <label for="pl_${pl.id}">${escapeHtml(pl.name)} (${pl.videoIds.length})</label>
          </div>
        `;
      })
      .join('');

    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const playlistId = cb.dataset.playlistId;
        if (cb.checked) {
          await chrome.runtime.sendMessage({ type: 'ADD_TO_PLAYLIST', playlistId, videoId });
          const pl = allPlaylists.find((p) => p.id === playlistId);
          if (pl && !pl.videoIds.includes(videoId)) pl.videoIds.push(videoId);
        } else {
          await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_PLAYLIST', playlistId, videoId });
          const pl = allPlaylists.find((p) => p.id === playlistId);
          if (pl) pl.videoIds = pl.videoIds.filter((id) => id !== videoId);
        }
        renderPlaylists();
      });
    });
  }

  document.getElementById('addToPlaylistModal').classList.remove('hidden');
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

// Nav buttons (All / YouTube / Netflix)
document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.nav-btn, .playlist-item').forEach((el) => el.classList.remove('active'));
    btn.classList.add('active');
      const labels = { all: chrome.i18n.getMessage('allVideos'), youtube: 'YouTube', netflix: 'Netflix' };
    document.getElementById('viewTitle').textContent = labels[currentView] || chrome.i18n.getMessage('allVideos');
    closePlayer();
    renderVideos();
  });
});
