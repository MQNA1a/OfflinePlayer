// chrome.storage.local wrapper for video metadata and playlist management

// ── Video Metadata ──

async function saveVideoMetadata(meta) {
  const { videos = [] } = await chrome.storage.local.get('videos');
  const index = videos.findIndex(v => v.videoId === meta.videoId);
  if (index >= 0) {
    videos[index] = { ...videos[index], ...meta };
  } else {
    videos.push(meta);
  }
  await chrome.storage.local.set({ videos });
}

async function getAllVideos() {
  const { videos = [] } = await chrome.storage.local.get('videos');
  return videos;
}

async function getVideo(id) {
  const { videos = [] } = await chrome.storage.local.get('videos');
  return videos.find(v => v.videoId === id) || null;
}

async function deleteVideo(id) {
  const { videos = [] } = await chrome.storage.local.get('videos');
  const filtered = videos.filter(v => v.videoId !== id);
  await chrome.storage.local.set({ videos: filtered });
  // Remove from all playlists
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  for (const pl of playlists) {
    pl.videoIds = (pl.videoIds || []).filter(vid => vid !== id);
  }
  await chrome.storage.local.set({ playlists });
}

// ── Sync from disk (restore after extension reinstall) ──

async function syncVideos(diskVideos) {
  const { videos: existing = [] } = await chrome.storage.local.get('videos');
  const diskMap = new Map(diskVideos.map(v => [v.videoId, v]));

  const merged = [];

  // Update existing entries with disk data (disk wins for status, fileSize, videoUrl)
  for (const v of existing) {
    const disk = diskMap.get(v.videoId);
    if (disk) {
      merged.push({
        ...v,
        ...disk,
        // Preserve enriched metadata if disk has empty values
        title: v.title || disk.title || '',
        author: v.author || disk.author || '',
        thumbnail: v.thumbnail || disk.thumbnail || '',
        lengthSeconds: v.lengthSeconds || disk.lengthSeconds || 0,
        qualityLabel: v.qualityLabel || disk.qualityLabel || '',
      });
      diskMap.delete(v.videoId);
    }
    // Entries not on disk are dropped
  }

  // Add remaining disk entries (new videos not in storage)
  for (const disk of diskMap.values()) {
    merged.push(disk);
  }

  await chrome.storage.local.set({ videos: merged });
  return merged;
}

// ── Download Status ──

async function setDownloadStatus(videoId, status) {
  const key = `downloadStatus_${videoId}`;
  await chrome.storage.local.set({ [key]: status });
}

async function getDownloadStatus(videoId) {
  const key = `downloadStatus_${videoId}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

async function clearDownloadStatus(videoId) {
  const key = `downloadStatus_${videoId}`;
  await chrome.storage.local.remove(key);
}

// ── Playlists ──

async function createPlaylist(name) {
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  const playlist = {
    id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    videoIds: [],
    createdAt: Date.now(),
  };
  playlists.push(playlist);
  await chrome.storage.local.set({ playlists });
  return playlist;
}

async function getPlaylists() {
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  return playlists;
}

async function getPlaylist(id) {
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  return playlists.find(p => p.id === id) || null;
}

async function addVideoToPlaylist(playlistId, videoId) {
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  const pl = playlists.find(p => p.id === playlistId);
  if (pl) {
    if (!pl.videoIds.includes(videoId)) {
      pl.videoIds.push(videoId);
    }
    await chrome.storage.local.set({ playlists });
  }
}

async function removeVideoFromPlaylist(playlistId, videoId) {
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  const pl = playlists.find(p => p.id === playlistId);
  if (pl) {
    pl.videoIds = (pl.videoIds || []).filter(vid => vid !== videoId);
    await chrome.storage.local.set({ playlists });
  }
}

async function deletePlaylist(id) {
  const { playlists = [] } = await chrome.storage.local.get('playlists');
  const filtered = playlists.filter(p => p.id !== id);
  await chrome.storage.local.set({ playlists: filtered });
}
