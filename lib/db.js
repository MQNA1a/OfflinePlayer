// db.js — IndexedDB wrapper for storing video blobs (supports dual video+audio)

const DB_NAME = 'youtube-offline-db';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// type: undefined (progressive/single) | 'video' | 'audio'
async function saveVideoBlob(videoId, blob, type) {
  const key = type ? `${videoId}_${type}` : videoId;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getVideoBlob(videoId, type) {
  const key = type ? `${videoId}_${type}` : videoId;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteVideoBlob(videoId, type) {
  // If type specified, delete only that key; otherwise delete all keys for this video
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    if (type) {
      tx.objectStore(STORE_NAME).delete(`${videoId}_${type}`);
    } else {
      tx.objectStore(STORE_NAME).delete(videoId);
      tx.objectStore(STORE_NAME).delete(`${videoId}_video`);
      tx.objectStore(STORE_NAME).delete(`${videoId}_audio`);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getVideoSize(videoId) {
  const blob = await getVideoBlob(videoId);
  return blob ? blob.size : 0;
}

async function getAllVideoIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
