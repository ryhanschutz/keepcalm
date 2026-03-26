// KeepCalm — Módulo de Notificações
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

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const label = roomName ? `#${roomName}` : `#${roomId}`;
      const notif = new Notification(`${sender} — ${label}`, {
        body: text.length > 80 ? text.slice(0, 80) + '…' : text,
        icon: './favicon.png',
        badge: './favicon.png',
        tag: roomId,
        silent: true, // som já tocamos manualmente
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

  // ── Som de notificação (Web Audio API — sem ficheiro externo) ─────────────
  function _playSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx  = new AudioCtx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      [[880, 0], [1100, 0.06], [880, 0.12]].forEach(([freq, when]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
        osc.connect(gain);
        osc.start(ctx.currentTime + when);
        osc.stop(ctx.currentTime + when + 0.12);
      });
    } catch (_) { /* silencioso */ }
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
