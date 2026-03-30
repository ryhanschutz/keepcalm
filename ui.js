// KeepCalm — Módulo de Interface (DOM + Eventos)
'use strict';

const UI = (() => {
  let _typingUsers = new Set();
  let _typingTimeout = null;
  let _fileSendProgresses = {}; // transferId → element
  let _inactivityTimer = null;
  const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutos

  // ── Refs ──────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    _bindEvents();
    _startInactivityTimer();
  }

  function _bindEvents() {
    // Identificação
    $('login-btn').addEventListener('click', _handleLogin);
    $('login-username').addEventListener('keydown', e => { if (e.key === 'Enter') _handleLogin(); });

    // Logout (Menu 3 pontos)
    $('menu-logout').addEventListener('click', () => App.logout());

    // Menu 3 Pontos (Toggle)
    $('sb-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('sb-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', () => $('sb-dropdown').classList.add('hidden'));

    // Pânico: Apagar Tudo
    $('menu-clear-db').addEventListener('click', async () => {
      if (!confirm('ATENÇÃO: Isso apagará TODAS as mensagens, arquivos e configurações permanentemente. Confirmar?')) return;
      await Storage.clearEverything();
      window.location.reload();
    });

    // Abrir modal de sala
    $('join-room-btn').addEventListener('click', () => showModal('join-room-modal'));

    // Modal de sala — cancelar
    $('modal-cancel').addEventListener('click', () => hideModal('join-room-modal'));
    $('join-room-modal').addEventListener('click', e => { if (e.target.id === 'join-room-modal') hideModal('join-room-modal'); });

    // Modal de sala — confirmar
    $('modal-confirm').addEventListener('click', _handleJoinRoom);
    $('modal-room-password').addEventListener('keydown', e => { if (e.key === 'Enter') _handleJoinRoom(); });

    // Enviar mensagem
    $('send-btn').addEventListener('click', _handleSend);
    $('msg-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _handleSend();
      } else {
        const { currentRoom } = App.getState();
        if (currentRoom) App.sendTyping(currentRoom);
      }
    });
    $('msg-input').addEventListener('input', _autoResize);

    // Arquivo
    $('file-btn').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', _handleFileSelect);

    // Fechar sala
    $('leave-room-btn').addEventListener('click', _handleLeaveRoom);

    // Lock Screen
    $('lock-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const pw = e.target.value;
        if (App.unlock(pw)) {
          e.target.value = '';
          hideLockScreen();
          _startInactivityTimer();
        } else {
          e.target.style.borderColor = 'var(--danger)';
          setTimeout(() => { e.target.style.borderColor = ''; }, 500);
        }
      }
    });

    // Reset de inatividade ao interagir
    const reset = () => _startInactivityTimer();
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('click', reset);

    // Visibilidade da janela
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        Notifications.restoreTitle();
        _startInactivityTimer();
      }
    });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function _handleLogin() {
    const username = $('login-username').value.trim();
    const accessPw = $('login-access-pw').value;
    if (!username || !accessPw) {
      _showLoginError('Digite apelido e senha de acesso.');
      return;
    }
    _setLoginLoading(true);
    _clearLoginError();
    try {
      await App.login(username, accessPw);
      showApp(username);
      renderRoomsList(App.getState().rooms, App.getState().unreadCounts);
      await Notifications.requestPermission();
    } catch (e) {
      _showLoginError(e.message || 'Erro ao conectar.');
    } finally {
      _setLoginLoading(false);
    }
  }

  async function _handleJoinRoom() {
    const roomId   = $('modal-room-id').value.trim();
    const password = $('modal-room-password').value;
    if (!roomId || !password) { _showModalError('Preencha todos os campos.'); return; }
    $('modal-confirm').disabled = true;
    $('modal-confirm').textContent = 'Entrando…';
    try {
      const cleanId = await App.joinRoom(roomId, password);
      hideModal('join-room-modal');
      $('modal-room-id').value = '';
      $('modal-room-password').value = '';
      _clearModalError();
      renderRoomsList(App.getState().rooms, App.getState().unreadCounts);
      await App.switchRoom(cleanId);
    } catch (e) {
      _showModalError(e.message || 'Erro ao entrar na sala.');
    } finally {
      $('modal-confirm').disabled = false;
      $('modal-confirm').textContent = 'Entrar';
    }
  }

  async function _handleSend() {
    const { currentRoom } = App.getState();
    if (!currentRoom) return;
    const input = $('msg-input');
    const text  = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    await App.sendMessage(currentRoom, text);
  }

  async function _handleFileSelect(e) {
    const { currentRoom } = App.getState();
    if (!currentRoom) return;
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > CONFIG.app.maxFileSizeBytes) {
      alert(`Arquivo muito grande. Máximo: ${CONFIG.app.maxFileSizeBytes / 1024 / 1024}MB`);
      return;
    }

    try {
      await App.sendFile(currentRoom, file);
    } catch (err) {
      alert(err.message);
    }
  }

  async function _handleLeaveRoom() {
    const { currentRoom } = App.getState();
    if (!currentRoom) return;
    if (!confirm(`Sair da sala #${currentRoom} e apagar histórico local?`)) return;
    await App.leaveRoom(currentRoom);
    renderRoomsList(App.getState().rooms, App.getState().unreadCounts);
    _showEmptyState();
  }

  function _autoResize() {
    const el = $('msg-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  // ── Telas ─────────────────────────────────────────────────────────────────
  function showLogin() {
    $('login-screen').classList.remove('hidden');
    $('app-screen').classList.add('hidden');
    $('login-username').value = '';
    _clearLoginError();
  }

  function showLoginWithSavedUser(username) {
    showLogin();
    $('login-username').value = username;
    $('login-btn').focus();
  }

  function showApp(username) {
    $('login-screen').classList.add('hidden');
    $('app-screen').classList.remove('hidden');
    $('current-username').textContent = username;
    _showEmptyState();
  }

  function _showEmptyState() {
    $('empty-state').classList.remove('hidden');
    $('chat-view').classList.add('hidden');
  }

  function _showChatView() {
    $('empty-state').classList.add('hidden');
    $('chat-view').classList.remove('hidden');
  }

  // ── Modals ────────────────────────────────────────────────────────────────
  function showModal(id) {
    $(id).classList.remove('hidden');
    $(id).classList.add('modal-visible');
    const first = $(id).querySelector('input');
    if (first) setTimeout(() => first.focus(), 50);
  }

  function hideModal(id) {
    $(id).classList.remove('modal-visible');
    setTimeout(() => $(id).classList.add('hidden'), 200);
    _clearModalError();
  }

  // ── Re-entrada de sala salva (Opção B) ─────────────────────────────────────
  // Chamado quando o usuário clica numa sala que já está na sidebar mas
  // a senha não foi re-digitada nesta sessão. Pré-preenche o ID da sala.
  function showRejoinModal(roomId) {
    $('modal-room-id').value       = roomId;
    $('modal-room-password').value = '';
    _clearModalError();
    showModal('join-room-modal');
    // Focar direto no campo de senha (ID já está preenchido)
    setTimeout(() => $('modal-room-password').focus(), 80);
  }

  // ── Status de conexão ─────────────────────────────────────────────────────
  function setConnectionStatus(status) {
    const el  = $('conn-status');
    const dot = $('conn-dot');
    const map = {
      online:       ['🟢 Conectado',    'dot-online'],
      reconnecting: ['🟡 Reconectando…','dot-warn'],
      offline:      ['🔴 Sem conexão',  'dot-offline'],
    };
    const [text, cls] = map[status] || map.offline;
    el.textContent = text;
    dot.className  = `conn-dot ${cls}`;
  }

  // ── Lista de salas ────────────────────────────────────────────────────────
  function renderRoomsList(rooms, unreadCounts = {}) {
    const list = $('rooms-list');
    list.innerHTML = '';
    if (rooms.length === 0) {
      list.innerHTML = '<li class="no-rooms">Nenhuma sala ainda.<br>Clique em + para entrar.</li>';
      return;
    }
    rooms.forEach(room => {
      const li  = document.createElement('li');
      li.className = 'room-item';
      li.id        = `room-item-${room.id}`;
      const unread = unreadCounts[room.id] || 0;
      li.innerHTML = `
        <span class="room-icon"><svg><use href="#icon-hash"/></svg></span>
        <span class="room-name">${_esc(room.id)}</span>
        ${unread > 0 ? `<span class="badge" id="badge-${room.id}">${unread}</span>` : `<span class="badge hidden" id="badge-${room.id}"></span>`}
      `;
      li.addEventListener('click', () => App.switchRoom(room.id));
      list.appendChild(li);
    });
  }

  function highlightRoom(roomId) {
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    const el = $(`room-item-${roomId}`);
    if (el) el.classList.add('active');
  }

  function setRoomBadge(roomId, count) {
    const el = $(`badge-${roomId}`);
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else           { el.textContent = '';     el.classList.add('hidden'); }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  function renderChatRoom(roomId, messages, onlineUsers) {
    _showChatView();
    $('chat-room-name').textContent = `#${roomId}`;
    $('leave-room-btn').setAttribute('data-room', roomId);
    $('messages-area').innerHTML = '';
    _typingUsers.clear();
    $('typing-indicator').textContent = '';
    $('typing-indicator').classList.add('hidden');

    if (messages.length === 0) {
      $('messages-area').innerHTML = `
        <div class="no-messages">
          <div class="lock-icon-lg"><svg><use href="#icon-lock"/></svg></div>
          <p>Nenhuma mensagem ainda.<br>Sessão cifrada ponta a ponta.</p>
        </div>`;
    } else {
      messages.forEach(msg => _renderMessage(msg, false));
    }

    updateOnlineList(onlineUsers);
    _scrollToBottom(true);
    $('msg-input').focus();
  }

  function appendMessage(msg) {
    _renderMessage(msg, true);
    _scrollToBottom();
  }

  function _renderMessage(msg, scroll) {
    const container = $('messages-area');
    if (msg.type === 'file') {
      container.appendChild(_buildFileMessage(msg));
    } else {
      container.appendChild(_buildTextMessage(msg));
    }
    if (scroll) _scrollToBottom();
  }

  function _buildTextMessage(msg) {
    const div = document.createElement('div');
    div.className = `msg ${msg.isMine ? 'msg-mine' : 'msg-theirs'}`;
    div.innerHTML = `
      <div class="msg-meta">
        <span class="msg-sender">${msg.isMine ? 'Você' : _esc(msg.sender)}</span>
        <span class="msg-time">${_formatTime(msg.timestamp)}</span>
      </div>
      <div class="msg-bubble">${_linkify(_esc(msg.text))}</div>
    `;
    return div;
  }

  function _buildFileMessage(msg) {
    const div = document.createElement('div');
    div.className = `msg ${msg.isMine ? 'msg-mine' : 'msg-theirs'}`;
    const isImg  = msg.mimeType && msg.mimeType.startsWith('image/');
    const isPDF  = msg.mimeType === 'application/pdf' || (msg.fileName && msg.fileName.toLowerCase().endsWith('.pdf'));
    const isZip  = (msg.mimeType && (msg.mimeType.includes('zip') || msg.mimeType.includes('rar') || msg.mimeType.includes('compressed'))) ||
                   (msg.fileName && (msg.fileName.toLowerCase().endsWith('.zip') || msg.fileName.toLowerCase().endsWith('.rar') || msg.fileName.toLowerCase().endsWith('.7z')));
    
    const sizeStr = msg.fileSize ? ` · ${_formatSize(msg.fileSize)}` : '';

    let iconId = '#icon-clip';
    let iconClass = '';
    if (isImg) iconId = '#icon-image';
    else if (isPDF) { iconId = '#icon-pdf'; iconClass = 'pdf-icon'; }
    else if (isZip) { iconId = '#icon-archive'; iconClass = 'zip-icon'; }

    div.innerHTML = `
      <div class="msg-meta">
        <span class="msg-sender">${msg.isMine ? 'Você' : _esc(msg.sender)}</span>
        <span class="msg-time">${_formatTime(msg.timestamp)}</span>
      </div>
      <div class="msg-bubble msg-file" id="file-msg-${msg.transferId}">
        <div class="file-header">
          <span class="file-icon ${iconClass}"><svg><use href="${iconId}"/></svg></span>
          <span class="file-name">${_esc(msg.fileName)}</span>
          <span class="file-size">${sizeStr}</span>
        </div>
        ${isImg ? `<div class="file-img-wrap"><div class="file-img-loading">Carregando…</div></div>` : ''}
        <button class="file-dl-btn" data-tid="${msg.transferId}" data-name="${_esc(msg.fileName)}" data-mime="${msg.mimeType || ''}">
          <svg><use href="#icon-download"/></svg> Baixar
        </button>
      </div>
    `;

    // Ao clicar em baixar, lê do IndexedDB
    div.querySelector('.file-dl-btn').addEventListener('click', async (e) => {
      const tid  = e.currentTarget.dataset.tid;
      const name = e.currentTarget.dataset.name;
      const mime = e.currentTarget.dataset.mime;
      const rec  = await Storage.getFile(tid);
      if (!rec) { alert('Arquivo não encontrado no armazenamento local.'); return; }
      _downloadBlob(rec.blob, name, mime);
    });

    // Se imagem, tentar renderizar
    if (isImg && msg.transferId) {
      Storage.getFile(msg.transferId).then(rec => {
        if (!rec) return;
        const wrap = div.querySelector('.file-img-wrap');
        if (!wrap) return;
        const url = URL.createObjectURL(rec.blob);
        wrap.innerHTML = `<img src="${url}" class="file-img" alt="${_esc(msg.fileName)}" />`;
      });
    }

    return div;
  }

  // ── Progresso de arquivo (envio) ──────────────────────────────────────────
  function showFileSendProgress(transferId, filename, pct) {
    const el = _buildProgressEl(transferId, filename, pct, 'Enviando');
    $('messages-area').appendChild(el);
    _fileSendProgresses[transferId] = el;
    _scrollToBottom();
  }

  function updateFileSendProgress(transferId, pct) {
    const el = _fileSendProgresses[transferId] || $(`progress-${transferId}`);
    if (!el) return;
    el.querySelector('.prog-bar-fill').style.width = `${pct}%`;
    el.querySelector('.prog-label').textContent = `${pct}%`;
  }

  function completeFileSend(transferId) {
    const el = _fileSendProgresses[transferId] || $(`progress-${transferId}`);
    if (el) el.remove();
    delete _fileSendProgresses[transferId];
  }

  // ── Progresso de arquivo (recepção) ───────────────────────────────────────
  function showFileReceiving(transferId, filename, fileSize) {
    const el = _buildProgressEl(transferId, filename, 0, 'Recebendo');
    $('messages-area').appendChild(el);
    _scrollToBottom();
  }

  function updateFileProgress(transferId, pct) {
    updateFileSendProgress(transferId, pct); // mesma lógica
  }

  function completeFileReceiving(transferId, msg) {
    const el = $(`progress-${transferId}`);
    if (el) el.remove();
    _renderMessage(msg, true);
  }

  function _removeProgressEl(transferId) {
    const el = $(`progress-${transferId}`) || _fileSendProgresses[transferId];
    if (el) el.remove();
    delete _fileSendProgresses[transferId];
  }

  function _buildProgressEl(transferId, filename, pct, verb) {
    const div = document.createElement('div');
    div.className = 'msg msg-mine';
    div.id = `progress-${transferId}`;
    div.innerHTML = `
      <div class="msg-bubble msg-file">
        <div class="file-header">
          <span class="file-icon"><svg><use href="#icon-clip"/></svg></span>
          <span class="file-name">${_esc(filename)}</span>
        </div>
        <div class="prog-wrap">
          <div class="prog-bar"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
          <span class="prog-label">${pct}%</span>
        </div>
        <span class="prog-verb">${verb}…</span>
      </div>
    `;
    return div;
  }

  // ── Lista de online ───────────────────────────────────────────────────────
  function updateOnlineList(users) {
    const list = $('online-list');
    list.innerHTML = '';
    if (!users || users.length === 0) {
      list.innerHTML = '<li class="no-online">Ninguém online agora.</li>';
      return;
    }
    users.forEach(u => {
      const li = document.createElement('li');
      li.className = 'online-item';
      li.innerHTML = `<span class="online-dot"></span><span>${_esc(u)}</span>`;
      list.appendChild(li);
    });
    $('online-count').textContent = `${users.length} online`;
  }

  function updateGlobalUserStatus(username, status) {
    // Atualiza indicador visual global se implementado futuramente
  }

  // ── Digitando ─────────────────────────────────────────────────────────────
  function showTyping(username) {
    _typingUsers.add(username);
    _renderTyping();
  }

  function hideTyping(username) {
    _typingUsers.delete(username);
    _renderTyping();
  }

  function _renderTyping() {
    const el = $('typing-indicator');
    if (_typingUsers.size === 0) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      const names = Array.from(_typingUsers).join(', ');
      el.textContent = `${names} ${_typingUsers.size === 1 ? 'está' : 'estão'} digitando…`;
      el.classList.remove('hidden');
    }
  }

  // ── Erros de login/modal ──────────────────────────────────────────────────
  function _showLoginError(msg) {
    const el = $('login-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function _clearLoginError() {
    const el = $('login-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }
  function _setLoginLoading(v) {
    const btn = $('login-btn');
    btn.disabled     = v;
    btn.textContent  = v ? 'Conectando…' : 'Entrar';
  }
  function _showModalError(msg) {
    const el = $('modal-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }
  function _clearModalError() {
    const el = $('modal-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }

  // ── Scroll ────────────────────────────────────────────────────────────────
  function _scrollToBottom(instant = false) {
    const el = $('messages-area');
    if (!el) return;
    if (instant) { el.scrollTop = el.scrollHeight; return; }
    // Só scroll automático se o usuário já estava perto do fim
    const threshold = 150;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      el.scrollTop = el.scrollHeight;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _linkify(text) {
    return text.replace(
      /(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  function _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function _downloadBlob(blob, filename, mime) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Phantom Mode / Lock ───────────────────────────────────────────────────
  function _startInactivityTimer() {
    if (_inactivityTimer) clearTimeout(_inactivityTimer);
    if ($('lock-screen').classList.contains('hidden')) {
      _inactivityTimer = setTimeout(() => {
        showLockScreen();
      }, INACTIVITY_LIMIT);
    }
  }

  function showLockScreen() {
    $('lock-screen').classList.remove('hidden');
    $('lock-input').focus();
    App.lock(); // Invalida chaves na RAM
  }

  function hideLockScreen() {
    $('lock-screen').classList.add('hidden');
  }

  return {
    init,
    showLogin,
    showLoginWithSavedUser,
    showApp,
    showModal,
    hideModal,
    showRejoinModal,
    showLockScreen,
    hideLockScreen,
    setConnectionStatus,
    renderRoomsList,
    highlightRoom,
    setRoomBadge,
    renderChatRoom,
    appendMessage,
    updateOnlineList,
    updateGlobalUserStatus,
    showTyping,
    hideTyping,
    // Arquivo — envio
    showFileSendProgress,
    updateFileSendProgress,
    completeFileSend,
    // Arquivo — recepção
    showFileReceiving,
    updateFileProgress,
    completeFileReceiving,
  };
})();
