// content.js — ISOLATED world, document_idle
// YouTube download button injection.

let downloadButton = null;
let qualitySelect = null;
let statusBanner = null;
let isDownloading = false;
let observer = null;
let lastUrl = location.href;

function alive() {
  try { return typeof chrome !== 'undefined' && chrome?.runtime?.id !== undefined; }
  catch (e) { return false; }
}

// ── Download button ──────────────────────────────────────────
function addDownloadButton() {
  if (downloadButton) { downloadButton.remove(); downloadButton = null; }
  if (qualitySelect) { qualitySelect.remove(); qualitySelect = null; }

  if (location.pathname !== '/watch') return;

  const container =
    document.querySelector('#top-row #actions') ||
    document.querySelector('#actions') ||
    document.querySelector('#menu-container');

  if (!container) {
    if (alive()) setTimeout(addDownloadButton, 1500);
    return;
  }

  // Quality dropdown
  qualitySelect = document.createElement('select');
  qualitySelect.innerHTML = `
    <option value="auto">${chrome.i18n.getMessage('qualityAuto')}</option>
    <option value="1080">1080p</option>
    <option value="720">720p</option>
    <option value="480">480p</option>
    <option value="360">360p</option>
  `;
  Object.assign(qualitySelect.style, {
    padding: '6px 8px', backgroundColor: '#1a1a1a', color: '#fff',
    border: '1px solid #555', borderRadius: '18px', fontSize: '14px',
    fontWeight: '500', cursor: 'pointer', marginLeft: '8px', outline: 'none',
  });

  chrome.storage.local.get('downloadQuality', (result) => {
    if (result.downloadQuality) qualitySelect.value = result.downloadQuality;
  });
  qualitySelect.addEventListener('change', () => {
    chrome.storage.local.set({ downloadQuality: qualitySelect.value });
  });

  downloadButton = document.createElement('button');
  downloadButton.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/>
    </svg>
    <span>${chrome.i18n.getMessage('saveOffline')}</span>
  `;

  Object.assign(downloadButton.style, {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '8px 16px', backgroundColor: '#cc0000', color: '#fff',
    border: 'none', borderRadius: '18px', fontSize: '14px', fontWeight: '500',
    cursor: 'pointer', marginLeft: '8px', transition: 'background-color 0.2s',
  });

  downloadButton.addEventListener('mouseenter', () => { downloadButton.style.backgroundColor = '#aa0000'; });
  downloadButton.addEventListener('mouseleave', () => { downloadButton.style.backgroundColor = '#cc0000'; });
  downloadButton.addEventListener('click', handleDownloadClick);
  container.appendChild(downloadButton);
  container.appendChild(qualitySelect);
}

async function handleDownloadClick() {
  if (isDownloading) {
    try {
      chrome.runtime.sendMessage({ type: 'CANCEL_DOWNLOAD' });
      downloadButton.querySelector('span').textContent = chrome.i18n.getMessage('cancelling');
      downloadButton.disabled = true;
    } catch (e) {
      showStatus(chrome.i18n.getMessage('commErrorReload'), true);
    }
    return;
  }
  if (!alive()) {
    showStatus(chrome.i18n.getMessage('extensionUpdatedReload'), true);
    return;
  }

  isDownloading = true;
  downloadButton.disabled = false;
  downloadButton.querySelector('span').textContent = chrome.i18n.getMessage('downloadingShort') + ' (' + chrome.i18n.getMessage('cancel') + ')';
  downloadButton.style.backgroundColor = '#555';

  try {
    const quality = qualitySelect ? qualitySelect.value : 'auto';
    chrome.runtime.sendMessage({ type: 'DOWNLOAD', url: location.href, site: 'youtube', quality });
  } catch (e) {
    showStatus(chrome.i18n.getMessage('commErrorReload'), true);
    isDownloading = false;
    resetButton();
  }
}

function resetButton() {
  if (!downloadButton) return;
  downloadButton.disabled = false;
  downloadButton.querySelector('span').textContent = chrome.i18n.getMessage('saveOffline');
  downloadButton.style.backgroundColor = '#cc0000';
}

// ── Receive messages from background ─────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DOWNLOAD_PROGRESS') {
    if (downloadButton) {
      downloadButton.disabled = false;
      downloadButton.querySelector('span').textContent = chrome.i18n.getMessage('downloadingCancel', [Math.round(msg.percent)]);
    }
    return;
  }
  if (msg.type === 'DOWNLOAD_COMPLETE') {
    isDownloading = false;
    showStatus(chrome.i18n.getMessage('downloadComplete'));
    resetButton();
    return;
  }
  if (msg.type === 'DOWNLOAD_ERROR') {
    isDownloading = false;
    showStatus(chrome.i18n.getMessage('errorPrefix', [msg.error]), true);
    resetButton();
    return;
  }
  if (msg.type === 'DOWNLOAD_CANCELLED') {
    isDownloading = false;
    showStatus(chrome.i18n.getMessage('downloadCancelled'));
    resetButton();
    return;
  }
});

// ── Status banner ────────────────────────────────────────────
function showStatus(message, isError = false) {
  if (statusBanner) statusBanner.remove();
  statusBanner = document.createElement('div');
  statusBanner.textContent = message;
  Object.assign(statusBanner.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
    padding: '12px 20px', borderRadius: '8px', fontSize: '14px', color: '#fff',
    backgroundColor: isError ? '#cc0000' : '#1a73e8',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)', transition: 'opacity 0.3s',
    maxWidth: '400px',
  });
  document.body.appendChild(statusBanner);
  setTimeout(() => {
    if (!statusBanner) return;
    statusBanner.style.opacity = '0';
    setTimeout(() => { statusBanner?.remove(); statusBanner = null; }, 300);
  }, 8000);
}

// ── SPA navigation ───────────────────────────────────────────
function handleUrlChange() {
  if (!alive()) {
    try { observer?.disconnect(); } catch (e) {}
    observer = null;
    downloadButton?.remove(); downloadButton = null;
    showStatus(chrome.i18n.getMessage('extensionUpdatedReloadF5'), true);
    return;
  }
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    downloadButton?.remove(); downloadButton = null;
    qualitySelect?.remove(); qualitySelect = null;
    statusBanner?.remove(); statusBanner = null;
    isDownloading = false;
    setTimeout(() => { if (alive()) addDownloadButton(); }, 2000);
  }
}

// Patch history methods for reliable SPA navigation detection
const _origPushState = history.pushState;
history.pushState = function () {
  _origPushState.apply(this, arguments);
  handleUrlChange();
};
const _origReplaceState = history.replaceState;
history.replaceState = function () {
  _origReplaceState.apply(this, arguments);
  handleUrlChange();
};
window.addEventListener('popstate', handleUrlChange);

function init() {
  if (!alive()) return;
  if (document.body) {
    observer = new MutationObserver(handleUrlChange);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  setTimeout(() => { if (alive()) addDownloadButton(); }, 2000);

  // Periodic re-check: re-add button if SPA removed it from the DOM
  setInterval(() => {
    if (!alive()) return;
    if (location.pathname === '/watch' && !isDownloading &&
        (!downloadButton || !document.body.contains(downloadButton) ||
         !qualitySelect || !document.body.contains(qualitySelect))) {
      addDownloadButton();
    }
  }, 3000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
