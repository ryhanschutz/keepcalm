// KeepCalm — Módulo de Notificações (v2)
// Sistema completo: OS Notifications + Toast visual in-app + som + badge
'use strict';

const Notifications = (() => {
  let _unreadTotal = 0;
  const BASE_TITLE = 'KeepCalm ☕';

  // ── Permissão ─────────────────────────────────────────────────────────────
  async function requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  // ── Nova mensagem ─────────────────────────────────────────────────────────
  function notifyNewMessage(sender, text, roomId, roomName) {
    _unreadTotal++;
    _updateTitle();
    _playSound();
    _showToast(sender, text, roomId, roomName);

    // Notificação do SO (apenas quando a janela está em background)
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const label = roomName ? `#${roomName}` : `#${roomId}`;
      const notif  = new Notification(`${sender} — ${label}`, {
        body:   text.length > 80 ? text.slice(0, 80) + '…' : text,
        icon:   './icon.ico',
        badge:  './icon.ico',
        tag:    roomId,         // Agrupa notificações da mesma sala
        renotify: true,         // Re-toca som mesmo com mesmo tag
        silent: true,           // Som manual via Web Audio
      });
      notif.onclick = () => {
        window.focus();
        notif.close();
        if (typeof App !== 'undefined') App.switchRoom(roomId);
      };
    }
  }

  // ── Notificação de arquivo recebido ───────────────────────────────────────
  function notifyFileReceived(sender, filename, roomId) {
    notifyNewMessage(sender, `📎 ${filename}`, roomId, roomId);
  }

  // ── Toast visual in-app ───────────────────────────────────────────────────
  // Aparece no canto inferior direito, mesmo que o usuário esteja em outra sala.
  // Clicar abre a sala de origem da mensagem.
  function _showToast(sender, text, roomId, roomName) {
    // Não mostrar toast se o usuário já está na sala
    if (typeof App !== 'undefined') {
      const state = App.getState();
      if (state.currentRoom === roomId) return;
    }

    // Garantir que o container de toasts existe
    _ensureToastContainer();

    const toast   = document.createElement('div');
    toast.className = 'kc-toast';
    const label   = roomName || roomId;
    const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
    const initial = sender ? sender[0].toUpperCase() : '?';

    toast.innerHTML = `
      <div class="kc-toast-avatar">${_esc(initial)}</div>
      <div class="kc-toast-body">
        <div class="kc-toast-header">
          <span class="kc-toast-sender">${_esc(sender)}</span>
          <span class="kc-toast-room">#${_esc(label)}</span>
        </div>
        <div class="kc-toast-text">${_esc(preview)}</div>
      </div>
      <button class="kc-toast-close" title="Fechar">✕</button>
    `;

    // Clicar no toast leva para a sala
    toast.addEventListener('click', (e) => {
      if (e.target.classList.contains('kc-toast-close')) {
        _dismissToast(toast);
        return;
      }
      _dismissToast(toast);
      if (typeof App !== 'undefined') App.switchRoom(roomId);
    });

    // Botão de fechar
    toast.querySelector('.kc-toast-close').addEventListener('click', (e) => {
      e.stopPropagation();
      _dismissToast(toast);
    });

    const container = document.getElementById('kc-toast-container');
    container.appendChild(toast);

    // Animar entrada
    requestAnimationFrame(() => toast.classList.add('kc-toast-visible'));

    // Auto-dismiss após 5 segundos
    const timer = setTimeout(() => _dismissToast(toast), 5000);
    toast._dismissTimer = timer;

    // Pausar auto-dismiss ao hover
    toast.addEventListener('mouseenter', () => clearTimeout(toast._dismissTimer));
    toast.addEventListener('mouseleave', () => {
      toast._dismissTimer = setTimeout(() => _dismissToast(toast), 2500);
    });
  }

  function _dismissToast(toast) {
    clearTimeout(toast._dismissTimer);
    toast.classList.remove('kc-toast-visible');
    toast.classList.add('kc-toast-hiding');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 350);
  }

  function _ensureToastContainer() {
    if (document.getElementById('kc-toast-container')) return;
    const container = document.createElement('div');
    container.id = 'kc-toast-container';
    document.body.appendChild(container);

    // Injetar estilos dinamicamente (encapsulados aqui para zero dependência de CSS)
    if (document.getElementById('kc-toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'kc-toast-styles';
    style.textContent = `
      #kc-toast-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        display: flex;
        flex-direction: column-reverse;
        gap: 10px;
        pointer-events: none;
      }
      .kc-toast {
        display: flex;
        align-items: center;
        gap: 12px;
        background: rgba(30, 32, 42, 0.96);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 14px;
        padding: 12px 14px;
        min-width: 280px;
        max-width: 340px;
        cursor: pointer;
        pointer-events: all;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,101,246,0.15);
        transform: translateX(120%) scale(0.95);
        opacity: 0;
        transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
        position: relative;
      }
      .kc-toast.kc-toast-visible {
        transform: translateX(0) scale(1);
        opacity: 1;
      }
      .kc-toast.kc-toast-hiding {
        transform: translateX(110%) scale(0.9);
        opacity: 0;
      }
      .kc-toast:hover {
        border-color: rgba(124,101,246,0.4);
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,101,246,0.35);
      }
      .kc-toast-avatar {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: linear-gradient(135deg, #7c65f6, #5eadf6);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 15px;
        color: #fff;
        flex-shrink: 0;
        user-select: none;
      }
      .kc-toast-body {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      .kc-toast-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 2px;
      }
      .kc-toast-sender {
        font-weight: 600;
        font-size: 13px;
        color: #e2e4f0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .kc-toast-room {
        font-size: 11px;
        color: #7c65f6;
        background: rgba(124,101,246,0.12);
        padding: 1px 6px;
        border-radius: 4px;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .kc-toast-text {
        font-size: 12px;
        color: rgba(226,228,240,0.65);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .kc-toast-close {
        position: absolute;
        top: 8px;
        right: 10px;
        background: none;
        border: none;
        color: rgba(255,255,255,0.3);
        font-size: 12px;
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 4px;
        line-height: 1;
        transition: color 0.15s, background 0.15s;
        pointer-events: all;
      }
      .kc-toast-close:hover {
        color: rgba(255,255,255,0.8);
        background: rgba(255,255,255,0.08);
      }
    `;
    document.head.appendChild(style);
  }

  // ── Atualizar título com unread count ─────────────────────────────────────
  function _updateTitle() {
    document.title = _unreadTotal > 0 ? `(${_unreadTotal}) ${BASE_TITLE}` : BASE_TITLE;
  }

  // ── Limpar contador (ao focar numa sala) ──────────────────────────────────
  function clearUnread(count = 1) {
    _unreadTotal = Math.max(0, _unreadTotal - count);
    _updateTitle();
  }

  function resetAll() {
    _unreadTotal = 0;
    _updateTitle();
  }

  function setTitle(text) {
    document.title = text || BASE_TITLE;
  }

  function restoreTitle() {
    _updateTitle();
  }

  // ── Som de notificação (Web Audio API — sem arquivo externo) ──────────────
  // Tom suave de dois pulsos, discreto e não intrusivo.
  function _playSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx  = new AudioCtx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      [[880, 0], [1100, 0.07], [880, 0.14]].forEach(([freq, when]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
        osc.connect(gain);
        osc.start(ctx.currentTime + when);
        osc.stop(ctx.currentTime + when + 0.12);
      });
    } catch (_) { /* silencioso */ }
  }

  // ── Helper de escape XSS ──────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Visibilidade da aba ───────────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restoreTitle();
  });

  return {
    requestPermission,
    notifyNewMessage,
    notifyFileReceived,
    clearUnread,
    resetAll,
    setTitle,
    restoreTitle,
  };
})();
