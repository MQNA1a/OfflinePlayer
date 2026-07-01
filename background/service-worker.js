// service-worker.js
// Native Messaging bridge between the extension and yt-dlp host.

importScripts('../lib/storage.js');

const HOST_NAME = 'com.youtubeoffline';

// Track active download ports by tabId for cancellation
const activeDownloads = new Map();

// ── Message handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD') {
    handleDownload(message.url, sender.tab?.id, message.site || 'youtube', message.metadata, message.quality);
    sendResponse({ started: true });
    return false;
  }

  if (message.type === 'CANCEL_DOWNLOAD') {
    handleCancelDownload(sender.tab?.id);
    sendResponse({ cancelled: true });
    return false;
  }

  if (message.type === 'GET_ALL_VIDEOS') {
    getAllVideos().then(v => sendResponse({ videos: v }));
    return true;
  }

  if (message.type === 'DELETE_VIDEO') {
    handleDelete(message.videoId).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'SYNC_VIDEOS') {
    syncVideosFromDisk().then(async (result) => {
      sendResponse(result);
      if (!result.error && result.videos.length > 0) {
        enrichVideoMetadata();
      }
    });
    return true;
  }

  // Playlist operations (storage.js only)
  if (message.type === 'GET_PLAYLISTS') { getPlaylists().then(p => sendResponse({ playlists: p })); return true; }
  if (message.type === 'CREATE_PLAYLIST') { createPlaylist(message.name).then(p => sendResponse({ playlist: p })); return true; }
  if (message.type === 'ADD_TO_PLAYLIST') { addVideoToPlaylist(message.playlistId, message.videoId).then(() => sendResponse({ success: true })); return true; }
  if (message.type === 'REMOVE_FROM_PLAYLIST') { removeVideoFromPlaylist(message.playlistId, message.videoId).then(() => sendResponse({ success: true })); return true; }
  if (message.type === 'DELETE_PLAYLIST') { deletePlaylist(message.playlistId).then(() => sendResponse({ success: true })); return true; }
  if (message.type === 'GET_PLAYLIST') { getPlaylist(message.playlistId).then(p => sendResponse({ playlist: p })); return true; }
});

// ── Sync videos from disk on install/startup ────────────────
chrome.runtime.onInstalled.addListener(() => {
  syncVideosFromDisk().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncVideosFromDisk().catch(() => {});
});

async function syncVideosFromDisk() {
  // ── Method 1: HTTP (fast, reliable) ──
  try {
    const resp = await fetch('http://localhost:8462/__list__');
    if (resp.ok) {
      const data = await resp.json();
      if (data.videos) {
        return { videos: await syncVideos(data.videos), error: null };
      }
    }
  } catch (e) {
    // Server not running or old version — fall through to native messaging
  }

  // ── Method 2: Native messaging (fallback, also starts HTTP server) ──
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendNativeMessage(HOST_NAME, { action: 'list' }, (resp) => {
        if (chrome.runtime.lastError || !resp) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });

    if (!response || !response.videos) {
      return { videos: [], error: chrome.i18n.getMessage('serverConnectError') };
    }

    return { videos: await syncVideos(response.videos), error: null };
  } catch (e) {
    return { videos: [], error: String(e) };
  }
}

// ── Enrich metadata via oEmbed (for videos without sidecars) ──
async function enrichVideoMetadata() {
  const videos = await getAllVideos();
  const needEnrich = videos.filter(v => !v.title && (v.source || 'youtube') === 'youtube');
  if (needEnrich.length === 0) return;

  let enriched = 0;
  for (const v of needEnrich) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.videoId}&format=json`;
      const resp = await fetch(oembedUrl);
      if (resp.ok) {
        const data = await resp.json();
        await saveVideoMetadata({
          ...v,
          title: data.title || '',
          author: data.author_name || '',
          thumbnail: data.thumbnail_url || v.thumbnail || '',
        });
        enriched++;
      }
    } catch (_) {}
  }
  if (enriched > 0) {
    chrome.runtime.sendMessage({ type: 'METADATA_UPDATED' }).catch(() => {});
  }
}

// ── Download via Native Messaging ────────────────────────────
function handleDownload(url, tabId, site, metadata, quality) {
  const port = chrome.runtime.connectNative(HOST_NAME);

  // Register this download for cancellation
  if (tabId) activeDownloads.set(tabId, port);

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'progress') {
      // Forward progress to content script
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'DOWNLOAD_PROGRESS',
          percent: msg.percent,
        }).catch(() => {});
      }
      // Persist status for popup
      if (msg.videoId) {
        await setDownloadStatus(msg.videoId, { status: 'downloading', percent: msg.percent });
      }
      return;
    }

    if (msg.type === 'complete') {
      await saveVideoMetadata({
        videoId: msg.videoId,
        title: msg.title,
        author: msg.author,
        thumbnail: msg.thumbnail,
        lengthSeconds: msg.duration,
        downloadDate: Date.now(),
        status: 'complete',
        fileSize: msg.fileSize,
        videoUrl: msg.videoUrl,
        qualityLabel: msg.qualityLabel,
        source: msg.source || site || 'youtube',
      });
      await clearDownloadStatus(msg.videoId);

      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_COMPLETE' }).catch(() => {});
      }

      chrome.notifications.create(`dl_${msg.videoId}`, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: chrome.i18n.getMessage('downloadCompleteNotif'), message: msg.title,
      });

      if (tabId) activeDownloads.delete(tabId);
      port.disconnect();
      return;
    }

    if (msg.type === 'error') {
      const errorMsg = msg.errorCode
        ? chrome.i18n.getMessage(msg.errorCode) || msg.errorCode
        : msg.error;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_ERROR', error: errorMsg }).catch(() => {});
      }
      if (tabId) activeDownloads.delete(tabId);
      port.disconnect();
      return;
    }

    if (msg.type === 'cancelled') {
      if (msg.videoId) {
        await clearDownloadStatus(msg.videoId);
        await deleteVideo(msg.videoId);
      }
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { type: 'DOWNLOAD_CANCELLED' }).catch(() => {});
      }
      if (tabId) activeDownloads.delete(tabId);
      port.disconnect();
      return;
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId) activeDownloads.delete(tabId);
    const err = chrome.runtime.lastError?.message;
    if (err && tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'DOWNLOAD_ERROR',
        error: `Native host error: ${err}`,
      }).catch(() => {});
    }
  });

  port.postMessage({ action: 'download', url: url, site: site, metadata: metadata, quality: quality || 'auto' });
}

// ── Cancel download ─────────────────────────────────────────
function handleCancelDownload(tabId) {
  if (!tabId) return;
  const port = activeDownloads.get(tabId);
  if (port) {
    try {
      port.postMessage({ action: 'cancel' });
    } catch (e) {
      // Port may already be disconnected
      try { port.disconnect(); } catch (_) {}
      activeDownloads.delete(tabId);
    }
  }
}

// ── Delete ───────────────────────────────────────────────────
async function handleDelete(videoId) {
  // Ask native host to delete the file (fire-and-forget)
  try {
    chrome.runtime.sendNativeMessage(HOST_NAME, { action: 'delete', videoId }, () => {
      // Callback intentionally empty — storage cleanup is below
    });
  } catch (e) {
    // Host may not be running; still remove metadata
  }
  await deleteVideo(videoId);
}
