// custom-player.js — YouTube-style custom video player controller

class CustomPlayer {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} wrapper — container that holds the video + overlays
   * @param {object} options — { onEnded, onBack, qualityLabel }
   */
  constructor(video, wrapper, options = {}) {
    this.video = video;
    this.wrapper = wrapper;
    this.onEnded = options.onEnded || (() => {});
    this.onBack = options.onBack || (() => {});
    this._qualityLabel = options.qualityLabel || '';
    this._hideTimer = null;
    this._isSeeking = false;
    this._settingsOpen = false;

    this._buildDOM();
    this._bindEvents();
    this._showControls();
  }

  // ── DOM construction ──────────────────────────────────────
  _buildDOM() {
    // Remove native controls
    this.video.removeAttribute('controls');

    // Back button (top-left)
    this.backBtn = document.createElement('button');
    this.backBtn.className = 'cp-back-btn';
    this.backBtn.innerHTML = '←';
    this.backBtn.addEventListener('click', () => this.onBack());
    this.wrapper.appendChild(this.backBtn);

    // Skip back button
    this.skipBackBtn = document.createElement('div');
    this.skipBackBtn.className = 'cp-skip-btn cp-skip-back';
    this.skipBackBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/><text x="12" y="16" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor">10</text></svg>`;
    this.skipBackBtn.addEventListener('click', () => this._skip(-10));
    this.wrapper.appendChild(this.skipBackBtn);

    // Skip forward button
    this.skipFwdBtn = document.createElement('div');
    this.skipFwdBtn.className = 'cp-skip-btn cp-skip-fwd';
    this.skipFwdBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1l5 5-5 5V7c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6h2c0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8z"/><text x="12" y="16" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor">10</text></svg>`;
    this.skipFwdBtn.addEventListener('click', () => this._skip(10));
    this.wrapper.appendChild(this.skipFwdBtn);

    // Center play button
    this.centerPlay = document.createElement('div');
    this.centerPlay.className = 'cp-center-play';
    this.centerPlay.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    this.centerPlay.addEventListener('click', () => this.video.play());
    this.wrapper.appendChild(this.centerPlay);

    // Controls bar
    this.controls = document.createElement('div');
    this.controls.className = 'cp-controls';
    this.wrapper.appendChild(this.controls);

    // Progress bar
    this.progressContainer = document.createElement('div');
    this.progressContainer.className = 'cp-progress-container';
    this.progressTrack = document.createElement('div');
    this.progressTrack.className = 'cp-progress-track';
    this.progressBuffered = document.createElement('div');
    this.progressBuffered.className = 'cp-progress-buffered';
    this.progressPlayed = document.createElement('div');
    this.progressPlayed.className = 'cp-progress-played';
    this.progressHandle = document.createElement('div');
    this.progressHandle.className = 'cp-progress-handle';
    this.progressTrack.appendChild(this.progressBuffered);
    this.progressTrack.appendChild(this.progressPlayed);
    this.progressTrack.appendChild(this.progressHandle);
    this.progressContainer.appendChild(this.progressTrack);
    this.controls.appendChild(this.progressContainer);

    // Buttons row
    this.buttons = document.createElement('div');
    this.buttons.className = 'cp-buttons';
    this.controls.appendChild(this.buttons);

    // Play/pause
    this.playBtn = this._btn('play', `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`);
    this.playBtn.addEventListener('click', () => this._togglePlay());

    // Volume group
    this.muteBtn = this._btn('mute', `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`);
    this.muteBtn.addEventListener('click', () => this._toggleMute());
    this.volumeGroup = document.createElement('div');
    this.volumeGroup.className = 'cp-volume-group';
    this.volumeSlider = document.createElement('div');
    this.volumeSlider.className = 'cp-volume-slider';
    this.volumeFill = document.createElement('div');
    this.volumeFill.className = 'cp-volume-fill';
    this.volumeSlider.appendChild(this.volumeFill);
    this.volumeGroup.appendChild(this.muteBtn);
    this.volumeGroup.appendChild(this.volumeSlider);
    this.buttons.appendChild(this.volumeGroup);

    // Time
    this.timeDisplay = document.createElement('span');
    this.timeDisplay.className = 'cp-time';
    this.timeDisplay.textContent = '0:00 / 0:00';
    this.buttons.appendChild(this.timeDisplay);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'cp-spacer';
    this.buttons.appendChild(spacer);

    // Settings (quality)
    this.settingsWrap = document.createElement('div');
    this.settingsWrap.className = 'cp-settings-wrap';
    this.settingsBtn = this._btn('settings', `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`);
    this.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSettings();
    });

    this.settingsMenu = document.createElement('div');
    this.settingsMenu.className = 'cp-settings-menu';
    this._buildSettingsMenu();

    this.settingsWrap.appendChild(this.settingsBtn);
    this.settingsWrap.appendChild(this.settingsMenu);
    this.buttons.appendChild(this.settingsWrap);

    // Fullscreen
    this.fsBtn = this._btn('fullscreen', `<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`);
    this.fsBtn.addEventListener('click', () => this._toggleFullscreen());
    this.buttons.appendChild(this.fsBtn);

    // Initial state
    this.wrapper.classList.add('cp-wrapper', 'cp-paused', 'cp-show-controls');
  }

  _buildSettingsMenu() {
    this.settingsMenu.innerHTML = '';

    const qualityLabel = chrome.i18n.getMessage('quality') || 'Quality';
    const header = document.createElement('div');
    header.className = 'cp-settings-menu-header';
    header.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg><span>${qualityLabel}</span>`;
    this.settingsMenu.appendChild(header);

    const list = document.createElement('div');
    list.className = 'cp-settings-menu-list';

    // Available qualities (only the downloaded one is selectable)
    const qualities = ['1080p', '720p', '480p', '360p', 'Auto'];
    const currentQ = this._qualityLabel || 'Auto';

    qualities.forEach((q) => {
      const isActive = q === currentQ;
      const item = document.createElement('div');
      item.className = 'cp-settings-item' + (isActive ? ' active' : '');
      item.innerHTML = `
        <span class="cp-item-label">${q}</span>
        <svg class="cp-check" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      `;
      if (!isActive) {
        item.style.opacity = '0.4';
        item.style.cursor = 'default';
      }
      list.appendChild(item);
    });

    this.settingsMenu.appendChild(list);
  }

  _btn(cls, svgInner) {
    const b = document.createElement('button');
    b.className = `cp-btn cp-btn-${cls}`;
    b.innerHTML = svgInner;
    this.buttons.appendChild(b);
    return b;
  }

  // ── Event binding ─────────────────────────────────────────
  _bindEvents() {
    // Video events
    this.video.addEventListener('play', () => {
      this.wrapper.classList.remove('cp-paused');
      this.playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      this._scheduleHide();
    });
    this.video.addEventListener('pause', () => {
      this.wrapper.classList.add('cp-paused');
      this.playBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
      this._showControls();
    });
    this.video.addEventListener('timeupdate', () => this._updateProgress());
    this.video.addEventListener('progress', () => this._updateBuffered());
    this.video.addEventListener('volumechange', () => this._updateVolume());
    this.video.addEventListener('loadedmetadata', () => this._updateProgress());
    this.video.addEventListener('ended', () => this.onEnded());

    // Click video to play/pause
    this.video.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePlay();
    });

    // Double-click to fullscreen
    this.video.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._toggleFullscreen();
    });

    // Mouse move on wrapper → show controls
    this.wrapper.addEventListener('mousemove', () => {
      this._showControls();
      if (!this.video.paused) this._scheduleHide();
    });

    this.wrapper.addEventListener('mouseleave', () => {
      if (!this.video.paused && !this._settingsOpen) this._hideControls();
    });

    // Progress bar interaction
    this.progressContainer.addEventListener('mousedown', (e) => this._startSeek(e));
    document.addEventListener('mousemove', (e) => {
      if (this._isSeeking) this._seek(e);
    });
    document.addEventListener('mouseup', () => {
      if (this._isSeeking) this._isSeeking = false;
    });

    // Volume slider
    this.volumeSlider.addEventListener('click', (e) => {
      const rect = this.volumeSlider.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.video.volume = ratio;
      this.video.muted = ratio === 0;
    });

    // Fullscreen change
    document.addEventListener('fullscreenchange', () => this._onFullscreenChange());

    // Click outside settings to close
    document.addEventListener('click', (e) => {
      if (this._settingsOpen && !this.settingsWrap.contains(e.target)) {
        this._closeSettings();
      }
    });

    // Keyboard shortcuts
    this._keyHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Only handle if this player's wrapper is visible
      if (this.wrapper.offsetParent === null) return;

      this._showControls();
      if (!this.video.paused) this._scheduleHide();

      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'j':
          this._skip(-10);
          e.preventDefault();
          break;
        case 'arrowright':
        case 'l':
          this._skip(10);
          e.preventDefault();
          break;
        case ' ':
        case 'k':
          this._togglePlay();
          e.preventDefault();
          break;
        case 'arrowup':
          this.video.volume = Math.min(1, this.video.volume + 0.1);
          e.preventDefault();
          break;
        case 'arrowdown':
          this.video.volume = Math.max(0, this.video.volume - 0.1);
          e.preventDefault();
          break;
        case 'f':
          this._toggleFullscreen();
          e.preventDefault();
          break;
        case 'm':
          this._toggleMute();
          e.preventDefault();
          break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            this.video.currentTime = (this.video.duration || 0) * (parseInt(e.key) / 10);
            e.preventDefault();
          }
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  // ── Playback controls ─────────────────────────────────────
  _togglePlay() {
    if (this.video.paused) this.video.play().catch(() => {});
    else this.video.pause();
  }

  _skip(seconds) {
    this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, this.video.currentTime + seconds));
  }

  _toggleMute() {
    this.video.muted = !this.video.muted;
    if (!this.video.muted && this.video.volume === 0) {
      this.video.volume = 0.5;
    }
  }

  _toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.wrapper.requestFullscreen();
  }

  _onFullscreenChange() {
    if (document.fullscreenElement) {
      this.fsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;
    } else {
      this.fsBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
    }
  }

  // ── Settings menu ─────────────────────────────────────────
  _toggleSettings() {
    if (this._settingsOpen) this._closeSettings();
    else this._openSettings();
  }

  _openSettings() {
    this.settingsMenu.classList.add('open');
    this._settingsOpen = true;
  }

  _closeSettings() {
    this.settingsMenu.classList.remove('open');
    this._settingsOpen = false;
  }

  setQuality(label) {
    this._qualityLabel = label || '';
    this._buildSettingsMenu();
  }

  // ── Progress / volume updates ─────────────────────────────
  _updateProgress() {
    const cur = this.video.currentTime || 0;
    const dur = this.video.duration || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    this.progressPlayed.style.width = pct + '%';
    this.progressHandle.style.left = pct + '%';
    this.timeDisplay.textContent = `${this._fmtTime(cur)} / ${this._fmtTime(dur)}`;
  }

  _updateBuffered() {
    if (this.video.buffered.length > 0 && this.video.duration) {
      const end = this.video.buffered.end(this.video.buffered.length - 1);
      const pct = (end / this.video.duration) * 100;
      this.progressBuffered.style.width = pct + '%';
    }
  }

  _updateVolume() {
    const vol = this.video.muted ? 0 : this.video.volume;
    this.volumeFill.style.width = (vol * 100) + '%';
    if (vol === 0) {
      this.muteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
    } else {
      this.muteBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    }
  }

  // ── Seek ──────────────────────────────────────────────────
  _startSeek(e) {
    this._isSeeking = true;
    this._seek(e);
  }

  _seek(e) {
    const rect = this.progressTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (this.video.duration) {
      this.video.currentTime = ratio * this.video.duration;
    }
  }

  // ── Auto-hide ─────────────────────────────────────────────
  _showControls() {
    this.wrapper.classList.add('cp-show-controls');
    if (this._hideTimer) clearTimeout(this._hideTimer);
  }

  _hideControls() {
    this.wrapper.classList.remove('cp-show-controls');
    this._closeSettings();
  }

  _scheduleHide() {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (!this.video.paused && !this._settingsOpen) {
        this._hideControls();
      }
    }, 3000);
  }

  // ── Utility ───────────────────────────────────────────────
  _fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  destroy() {
    document.removeEventListener('keydown', this._keyHandler);
    if (this._hideTimer) clearTimeout(this._hideTimer);
  }
}
