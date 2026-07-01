// install.js — native host setup page logic

applyI18n();

const HOST_NAME = 'com.youtubeoffline';

const statusBox = document.getElementById('statusBox');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const checkBtn = document.getElementById('checkBtn');
const openFolderBtn = document.getElementById('openFolderBtn');

// ── Check native host connection ──
function checkConnection() {
  statusBox.className = 'status-box checking';
  statusIcon.textContent = '?';
  statusText.textContent = chrome.i18n.getMessage('setupChecking');
  checkBtn.disabled = true;

  chrome.runtime.sendNativeMessage(HOST_NAME, { action: 'list' }, (resp) => {
    checkBtn.disabled = false;

    if (chrome.runtime.lastError || !resp || !resp.videos) {
      statusBox.className = 'status-box not-connected';
      statusIcon.textContent = '\u2717';
      statusText.textContent = chrome.i18n.getMessage('setupNotConnected');
      return;
    }

    statusBox.className = 'status-box connected';
    statusIcon.textContent = '\u2713';
    statusText.textContent = chrome.i18n.getMessage('setupConnected');
  });
}

checkBtn.addEventListener('click', checkConnection);

// ── Open native-host folder ──
openFolderBtn.addEventListener('click', () => {
  const url = chrome.runtime.getURL('native-host/');
  chrome.tabs.create({ url });
});

// ── Auto-check on load ──
checkConnection();
