
(function () {
  'use strict';

  const LOG_PREFIX = '[MoeKoe下载]';
  const log   = (...args) => console.log(LOG_PREFIX, ...args);
  const warn  = (...args) => console.warn(LOG_PREFIX, ...args);
  const error = (...args) => console.error(LOG_PREFIX, ...args);

  class MoeKoeDownloader {
    constructor() {
      this.downloading = false;
      this.injected    = false;
    }

    start() {
      this.injectStyles();

      this.tryInject();

      this.observer = new MutationObserver(() => this.tryInject());
      this.observer.observe(document.body, { childList: true, subtree: true });

      log('插件已启动，等待播放栏加载...');
    }

    injectStyles() {
      if (document.getElementById('moekoe-dl-styles')) return;

      const style = document.createElement('style');
      style.id = 'moekoe-dl-styles';
      style.textContent = `
        /* 下载按钮基础样式 */
        .moekoe-dl-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 50%;
          background: transparent;
          color: rgb(0, 149, 255);
          cursor: pointer;
          transition: all 0.25s ease;
          font-size: 15px;
          margin-left: 6px;
          vertical-align: middle;
        }
        .moekoe-dl-btn:hover {
          color: #ff9100;
          background: rgba(255,107,139,0.12);
          transform: scale(1.15);
        }
        .moekoe-dl-btn:active {
          transform: scale(0.95);
        }
        /* 下载中状态 */
        .moekoe-dl-btn.is-downloading {
          color: #4caf50;
          animation: moekoe-spin 1s linear infinite;
          pointer-events: none;
        }
        @keyframes moekoe-spin {
          to { transform: rotate(360deg); }
        }

        /* 通知弹窗 */
        .moekoe-toast {
          position: fixed;
          top: 24px;
          right: 24px;
          padding: 12px 20px;
          border-radius: 10px;
          color: #fff;
          font-size: 13px;
          z-index: 99999;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.25);
          backdrop-filter: blur(12px);
          animation: moekoe-slide-in 0.35s ease;
          max-width: 380px;
          word-break: break-all;
          line-height: 1.4;
        }
        .moekoe-toast.success  { background: rgba(76,175,80,0.92); }
        .moekoe-toast.error    { background: rgba(244,67,54,0.92); }
        .moekoe-toast.info     { background: rgba(108,99,255,0.92); }
        .moekoe-toast.fade-out {
          opacity: 0;
          transform: translateX(60px);
          transition: all 0.3s ease;
        }
        @keyframes moekoe-slide-in {
          from { opacity: 0; transform: translateX(80px); }
          to   { opacity: 1; transform: translateX(0); }
        }

        /* 右键菜单 */
        .moekoe-ctx-menu {
          position: fixed;
          background: rgba(22,22,34,0.96);
          color: #eee;
          border-radius: 10px;
          padding: 6px 0;
          min-width: 190px;
          z-index: 99999;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          border: 1px solid rgba(255,255,255,0.08);
          backdrop-filter: blur(16px);
          animation: moekoe-pop 0.15s ease;
        }
        .moekoe-ctx-item {
          padding: 9px 18px;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: background 0.15s;
        }
        .moekoe-ctx-item:hover { background: rgba(255,107,139,0.15); }
        .moekoe-ctx-sep {
          height: 1px;
          background: rgba(255,255,255,0.08);
          margin: 4px 0;
        }
        @keyframes moekoe-pop {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }

    tryInject() {
      if (this.injected) return;

      const selectors = [
        '.player-bar .extra-controls',
        '.player-bar .controls',
        '.player-bar',
        '[class*="player"] [class*="control"]',
        '[class*="player-bar"]',
      ];

      let target = null;
      for (const sel of selectors) {
        target = document.querySelector(sel);
        if (target) break;
      }

      if (!target) return;

      if (document.querySelector('.moekoe-dl-btn')) {
        this.injected = true;
        return;
      }

      const btn = document.createElement('button');
      btn.className = 'moekoe-dl-btn';
      btn.title = '下载当前歌曲';
      btn.innerHTML = this.iconDownload();

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleDownload();
      });

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showContextMenu(e);
      });

      target.appendChild(btn);
      this.injected = true;
      log('下载按钮注入成功 ✓');
    }

    // ========== SVG 图标 ==========
    iconDownload() {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`;
    }

    iconSpinner() {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>`;
    }

    // ========== 获取歌曲信息 ==========
    getSongInfo() {
      const info = { title: '', artist: '', url: '', hash: '' };

      // 1) 从 DOM 提取歌名和歌手
      const titleSelectors = [
        '.player-bar .song-title',
        '.player-bar .title',
        '[class*="player"] [class*="title"]',
        '[class*="song-name"]',
        '[class*="track-name"]',
      ];
      const artistSelectors = [
        '.player-bar .artist',
        '.player-bar .singer',
        '[class*="player"] [class*="artist"]',
        '[class*="singer"]',
        '[class*="track-artist"]',
      ];

      for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          info.title = el.textContent.trim();
          break;
        }
      }

      for (const sel of artistSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          info.artist = el.textContent.trim();
          break;
        }
      }

      // 2) 获取音频 URL（多种方式）
      info.url = this.getAudioUrl();

      // 3) 尝试从 localStorage/sessionStorage 补充信息
      if (!info.title || !info.url) {
        try {
          const keys = ['current_song', 'currentSong', 'playingSong', 'nowPlaying'];
          for (const key of keys) {
            const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
            if (raw) {
              const song = JSON.parse(raw);
              if (!info.title && song.title) info.title = song.title;
              if (!info.title && song.name) info.title = song.name;
              if (!info.artist && song.artist) info.artist = song.artist;
              if (!info.artist && song.singer) info.artist = song.singer;
              if (!info.url && song.url) info.url = song.url;
              if (!info.url && song.play_url) info.url = song.play_url;
              if (song.hash) info.hash = song.hash;
              break;
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 4) 从 audio 元素获取 URL
      if (!info.url) {
        const audio = document.querySelector('audio');
        if (audio && audio.src) info.url = audio.src;
      }

      return info;
    }

    getAudioUrl() {
      const audio = document.querySelector('audio');
      if (audio && audio.src && audio.src.startsWith('http')) {
        return audio.src;
      }

      try {
        const keys = ['current_song', 'currentSong', 'playingSong', 'audio_url', 'playUrl'];
        for (const key of keys) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const data = JSON.parse(raw);
            const url = typeof data === 'string' ? data : (data.url || data.play_url || data.src);
            if (url && url.startsWith('http')) return url;
          }
        }
      } catch (e) { /* ignore */ }

      return '';
    }

    async handleDownload() {
      if (this.downloading) {
        this.toast('正在下载中，请稍等...', 'info');
        return;
      }

      const info = this.getSongInfo();

      if (!info.title) {
        this.toast('未检测到正在播放的歌曲', 'error');
        return;
      }
      if (!info.url) {
        this.toast('无法获取音频链接，可能该歌曲不支持下载', 'error');
        return;
      }

      this.downloading = true;
      this.setButtonState(true);

      const fileName = this.buildFileName(info);
      this.toast(`开始下载: ${fileName}`, 'info');

      try {
        await this.fetchAndSave(info.url, fileName);
        this.toast(`下载完成 ✓ ${fileName}`, 'success');
        this.saveHistory(info, fileName);
        log('下载完成:', fileName);
      } catch (err) {
        error('下载失败:', err);
        try {
          this.fallbackDownload(info.url, fileName);
          this.toast(`已通过浏览器下载: ${fileName}`, 'success');
        } catch (e2) {
          this.toast(`下载失败: ${err.message}`, 'error');
        }
      } finally {
        this.downloading = false;
        this.setButtonState(false);
      }
    }

    async fetchAndSave(url, fileName) {
      const resp = await fetch(url, {
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Accept': 'audio/*, */*',
          'Referer': window.location.origin,
        },
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const blob = await resp.blob();
      if (blob.size === 0) throw new Error('文件大小为 0');

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 200);
    }

    /** 降级下载：直接创建 <a> 链接 */
    fallbackDownload(url, fileName) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
    }

    // ========== 工具方法 ==========
    buildFileName(info) {
      const ext = this.guessExtension(info.url);
      const safeTitle = this.sanitize(info.title || '未知歌曲');
      const safeArtist = this.sanitize(info.artist || '');
      const name = safeArtist ? `${safeArtist} - ${safeTitle}` : safeTitle;
      return name.length > 200 ? name.slice(0, 200) + '.' + ext : name + '.' + ext;
    }

    guessExtension(url) {
      if (!url) return 'mp3';
      const clean = url.split('?')[0];
      const m = clean.match(/\.([a-zA-Z0-9]+)$/);
      if (m && ['mp3','flac','m4a','wav','ogg','aac'].includes(m[1].toLowerCase())) {
        return m[1].toLowerCase();
      }
      if (url.includes('flac')) return 'flac';
      if (url.includes('m4a'))  return 'm4a';
      return 'mp3';
    }

    sanitize(str) {
      return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+|\.+$/g, '').trim() || 'unknown';
    }

    setButtonState(isLoading) {
      const btn = document.querySelector('.moekoe-dl-btn');
      if (!btn) return;
      if (isLoading) {
        btn.classList.add('is-downloading');
        btn.innerHTML = this.iconSpinner();
        btn.title = '下载中...';
      } else {
        btn.classList.remove('is-downloading');
        btn.innerHTML = this.iconDownload();
        btn.title = '下载当前歌曲';
      }
    }

    // ========== Toast 通知 ==========
    toast(msg, type = 'info') {
      // 清除已有 toast
      document.querySelectorAll('.moekoe-toast').forEach(el => el.remove());

      const icons = { success: '✓', error: '✗', info: 'ℹ' };
      const el = document.createElement('div');
      el.className = `moekoe-toast ${type}`;
      el.innerHTML = `<span style="font-size:16px;font-weight:bold">${icons[type] || ''}</span><span>${msg}</span>`;
      document.body.appendChild(el);

      const delay = type === 'error' ? 4000 : 3000;
      setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 350);
      }, delay);
    }

    // ========== 右键菜单 ==========
    showContextMenu(e) {
      this.removeContextMenu();

      const info = this.getSongInfo();
      const menu = document.createElement('div');
      menu.className = 'moekoe-ctx-menu';

      const items = [
        { label: '⬇ 下载当前歌曲', action: () => this.handleDownload() },
        { sep: true },
        {
          label: '📋 复制歌曲信息',
          action: () => {
            const text = info.artist ? `${info.artist} - ${info.title}` : info.title;
            navigator.clipboard.writeText(text || '未知').then(
              () => this.toast('已复制歌曲信息', 'success'),
              () => this.toast('复制失败', 'error')
            );
          }
        },
        {
          label: '🔗 复制音频链接',
          action: () => {
            if (info.url) {
              navigator.clipboard.writeText(info.url).then(
                () => this.toast('已复制链接', 'success'),
                () => this.toast('复制失败', 'error')
              );
            } else {
              this.toast('无可用链接', 'error');
            }
          }
        },
        { sep: true },
        {
          label: '📜 下载历史',
          action: () => this.showHistory()
        },
      ];

      items.forEach(item => {
        if (item.sep) {
          const sep = document.createElement('div');
          sep.className = 'moekoe-ctx-sep';
          menu.appendChild(sep);
        } else {
          const el = document.createElement('div');
          el.className = 'moekoe-ctx-item';
          el.textContent = item.label;
          el.addEventListener('click', () => {
            this.removeContextMenu();
            item.action();
          });
          menu.appendChild(el);
        }
      });

      // 定位
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = e.clientX, y = e.clientY;
      menu.style.left = x + 'px';
      menu.style.top  = y + 'px';
      document.body.appendChild(menu);

      // 边界修正
      const rect = menu.getBoundingClientRect();
      if (rect.right > vw) menu.style.left = (vw - rect.width - 10) + 'px';
      if (rect.bottom > vh) menu.style.top = (vh - rect.height - 10) + 'px';

      // 点击外部关闭
      setTimeout(() => {
        document.addEventListener('click', this._closeCtx, { once: true });
        document.addEventListener('contextmenu', this._closeCtx, { once: true });
      }, 10);
    }

    _closeCtx = () => this.removeContextMenu();

    removeContextMenu() {
      document.querySelectorAll('.moekoe-ctx-menu').forEach(el => el.remove());
    }

    // ========== 下载历史 ==========
    saveHistory(info, fileName) {
      try {
        const history = JSON.parse(localStorage.getItem('moekoe_dl_history') || '[]');
        history.unshift({
          title: info.title,
          artist: info.artist,
          fileName,
          time: new Date().toISOString(),
        });
        if (history.length > 50) history.length = 50;
        localStorage.setItem('moekoe_dl_history', JSON.stringify(history));
      } catch (e) { warn('保存历史失败', e); }
    }

    showHistory() {
      try {
        const history = JSON.parse(localStorage.getItem('moekoe_dl_history') || '[]');
        if (!history.length) {
          this.toast('暂无下载记录', 'info');
          return;
        }

        // 创建遮罩
        const overlay = document.createElement('div');
        overlay.className = 'moekoe-toast info';
        overlay.style.cssText = `
          position:fixed; top:0; left:0; right:0; bottom:0;
          width:100%; height:100%; max-width:100%;
          background:rgba(0,0,0,0.7); z-index:99998;
          border-radius:0; animation:none;
          display:flex; align-items:center; justify-content:center;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
          background:rgba(22,22,34,0.98); color:#eee; border-radius:14px;
          padding:24px; width:480px; max-width:90vw; max-height:70vh;
          overflow-y:auto; box-shadow:0 12px 40px rgba(0,0,0,0.5);
          border:1px solid rgba(255,255,255,0.08);
        `;

        let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="margin:0;color:#ff6b8b;font-size:16px">📜 下载历史 (${history.length})</h3>
          <button id="moekoe-close-hist" style="background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:18px;cursor:pointer;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center">×</button>
        </div>`;

        history.forEach((h, i) => {
          const date = new Date(h.time).toLocaleString('zh-CN');
          html += `<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 14px;margin-bottom:8px;border-left:3px solid #ff6b8b">
            <div style="font-weight:600;color:#ff6b8b;font-size:13px">${h.fileName || (h.artist + ' - ' + h.title)}</div>
            <div style="font-size:11px;color:#888;margin-top:4px">${date}</div>
          </div>`;
        });

        html += `<div style="text-align:right;margin-top:12px">
          <button id="moekoe-clear-hist" style="background:rgba(244,67,54,0.15);color:#f44336;border:1px solid rgba(244,67,54,0.3);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px">清除全部</button>
        </div>`;

        panel.innerHTML = html;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // 事件绑定
        overlay.querySelector('#moekoe-close-hist').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const clearBtn = overlay.querySelector('#moekoe-clear-hist');
        clearBtn.addEventListener('click', () => {
          localStorage.removeItem('moekoe_dl_history');
          this.toast('已清除全部历史', 'success');
          overlay.remove();
        });

        // ESC 关闭
        const esc = (e) => {
          if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        };
        document.addEventListener('keydown', esc);

      } catch (e) {
        error('显示历史失败', e);
        this.toast('无法显示下载历史', 'error');
      }
    }
  }

  // ========== 启动 ==========
  const downloader = new MoeKoeDownloader();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => downloader.start(), 800));
  } else {
    setTimeout(() => downloader.start(), 800);
  }

  // 暴露到全局方便调试
  window.moekoeDownloader = downloader;

})();
