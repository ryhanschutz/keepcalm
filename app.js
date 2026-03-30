// KeepCalm — Lógica Principal (MQTT + Rooms + Mensagens + Arquivos)
'use strict';

const App = (() => {
  // ── Estado ────────────────────────────────────────────────────────────────
  let mqttClient    = null;
  let currentUser   = null;   // { username }
  let currentRoom   = null;   // roomId string
  let rooms         = [];     // [{ id, name, createdAt }]
  let roomCryptoKeys = {};    // roomId → CryptoKey (AES-256-GCM)
  let onlineInRoom  = {};     // roomId → Set<string>
  let unreadCounts  = {};     // roomId → number
  let typingTimers  = {};
  let heartbeatTimer = null;
  let fileChunks    = {};     // transferId → { meta, chunks[], received }
  let _accessPw     = null;
  let _isLocked     = false;

  // ── Inicialização ─────────────────────────────────────────────────────────
  async function init() {
    await Storage.init();
    // No Phantom Mode, nunca lembramos o usuário. Sempre tela de login limpa.
    UI.showLogin();
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login(username, accessPw) {
    if (!username || !accessPw) throw new Error('Apelido e Senha de Acesso são obrigatórios.');

    // Verifica se mudou o usuário ou se a senha confere
    await Storage.verifyUser(username, accessPw);

    currentUser = { username };
    _accessPw   = accessPw;

    // Conectar ao MQTT
    await _connectMQTT(username);

    // Iniciar vigilantes e carregar sessões anteriores (Ninja Mode)
    _startHeartbeat();
    _initNetworkMonitoring();
    _rejoinSavedRooms();
  }

  // ── Conexão MQTT ──────────────────────────────────────────────────────────
  async function _connectMQTT(username) {
    return new Promise((resolve, reject) => {
      const clientId = `kc_${username.replace(/\W/g,'')}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const willPayload = JSON.stringify({ username, status: 'offline', ts: Date.now() });

      mqttClient = mqtt.connect(CONFIG.mqtt.url, {
        clientId,
        username:       CONFIG.mqtt.username,
        password:       CONFIG.mqtt.password,
        keepalive:      CONFIG.mqtt.keepalive,
        reconnectPeriod: CONFIG.mqtt.reconnectPeriod,
        connectTimeout: CONFIG.mqtt.connectTimeout,
        clean:          true,
        will: {
          topic:   CONFIG.topics.userPresence(username),
          payload: willPayload,
          qos:     1,
          retain:  true,
        },
      });

      mqttClient.once('connect', () => resolve());
      mqttClient.once('error',   (err) => reject(new Error(`Erro MQTT: ${err.message}`)));

      mqttClient.on('connect',   _onConnect);
      mqttClient.on('reconnect', () => UI.setConnectionStatus('reconnecting'));
      mqttClient.on('offline',   () => UI.setConnectionStatus('offline'));
      mqttClient.on('close',     () => UI.setConnectionStatus('offline'));
      mqttClient.on('message',   _handleMessage);

      // Timeout
      const t = setTimeout(() => reject(new Error('Tempo esgotado ao conectar ao broker.')), CONFIG.mqtt.connectTimeout);
      mqttClient.once('connect', () => clearTimeout(t));
    });
  }

  function _onConnect() {
    UI.setConnectionStatus('online');
    // Subscrever à presença global
    mqttClient.subscribe('keepcalm/presence/+', { qos: 0 });
    // Re-subscrever a todas as salas que já estão abertas na memória (Sessão viva)
    rooms.forEach(room => {
      _subscribeRoom(room.id);
      _publishPresence(room.id, 'online');
    });
  }

  // ── Reatualização de salas após reconexão ─────────────────────────────────
  // ── Reatualização de salas após reconexão / Início ────────────────────────
  // Opção B: Carrega os IDs das salas salvas na memória, mas NÃO as senhas.
  // As salas aparecem na sidebar; o usuário deve clicar e re-digitar a senha
  // para reativar a criptografia e receber mensagens.
  async function _rejoinSavedRooms() {
    rooms = Storage.getRooms();
    // Chaves ficam ausentes até o usuário autenticar cada sala novamente
    UI.renderRoomsList(rooms, unreadCounts);
  }

  // ── Entrar em sala / Sessão ───────────────────────────────────────────────
  async function joinRoom(roomId, roomPassword) {
    if (_isLocked) throw new Error('App Bloqueado.');
    const cleanId = roomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!cleanId || !roomPassword) throw new Error('Nome e senha da sala são obrigatórios.');

    // Derivar chave com a senha de fora
    const key = await Crypto.deriveRoomKey(cleanId, roomPassword);
    roomCryptoKeys[cleanId] = key;

    // Persistência de ID (Opção B): Salva apenas o ID da sala, nunca a senha.
    if (!rooms.find(r => r.id === cleanId)) {
      rooms.push({ id: cleanId, name: cleanId, createdAt: Date.now() });
      Storage.setRooms(rooms);
    }
    // Senha fica SOMENTE na RAMcomo roomCryptoKeys[cleanId] — zero disco.

    _subscribeRoom(cleanId);
    _publishPresence(cleanId, 'online');

    return cleanId;
  }

  // ── Sair de sala ──────────────────────────────────────────────────────────
  async function leaveRoom(roomId) {
    _publishPresence(roomId, 'offline');
    _unsubscribeRoom(roomId);
    delete roomCryptoKeys[roomId];
    rooms = rooms.filter(r => r.id !== roomId);
    Storage.setRooms(rooms);
    // Não há senha salva para remover (Opção B)
    await Storage.clearMessages(roomId);
    if (currentRoom === roomId) currentRoom = null;
  }

  function _subscribeRoom(roomId) {
    mqttClient.subscribe(CONFIG.topics.roomMessages(roomId), { qos: 1 });
    mqttClient.subscribe(CONFIG.topics.roomPresence(roomId), { qos: 0 });
    mqttClient.subscribe(CONFIG.topics.roomTyping(roomId),   { qos: 0 });
    mqttClient.subscribe(CONFIG.topics.roomFiles(roomId),    { qos: 1 });

    Storage.listenToRoomHistoryP2P(roomId, (payloadObj) => {
      _processIncomingPayload(roomId, payloadObj);
    });
  }

  function _unsubscribeRoom(roomId) {
    mqttClient.unsubscribe(CONFIG.topics.roomMessages(roomId));
    mqttClient.unsubscribe(CONFIG.topics.roomPresence(roomId));
    mqttClient.unsubscribe(CONFIG.topics.roomTyping(roomId));
    mqttClient.unsubscribe(CONFIG.topics.roomFiles(roomId));
  }

  // ── Roteamento de mensagens MQTT ─────────────────────────────────────────
  function _handleMessage(topic, payloadBuf) {
    try {
      const payload = payloadBuf.toString();
      const parts   = topic.split('/');
      // keepcalm/rooms/{roomId}/messages
      if (parts[1] === 'rooms' && parts[3] === 'messages')  { _processIncomingPayload(parts[2], payload); return; }
      // keepcalm/rooms/{roomId}/presence
      if (parts[1] === 'rooms' && parts[3] === 'presence')  { _onPresence(parts[2], payload); return; }
      // keepcalm/rooms/{roomId}/typing
      if (parts[1] === 'rooms' && parts[3] === 'typing')    { _onTyping(parts[2], payload); return; }
      // keepcalm/rooms/{roomId}/files/{transferId}
      if (parts[1] === 'rooms' && parts[3] === 'files')     { _onFileChunk(parts[2], parts[4], payload); return; }
      // keepcalm/presence/{username}
      if (parts[1] === 'presence')                          { _onGlobalPresence(parts[2], payload); return; }
    } catch (e) {
      console.error('[MQTT] Erro ao processar mensagem:', e);
    }
  }

  let _renderDebounce = null;
  function _queueRoomRender(roomId) {
    if (_renderDebounce) clearTimeout(_renderDebounce);
    _renderDebounce = setTimeout(async () => {
      if (roomId === currentRoom) {
        const msgs = await Storage.getMessages(roomId);
        UI.setMessages(msgs);
        UI.scrollToBottom();
      }
    }, 150);
  }

  async function _processIncomingPayload(roomId, payload) {
    const key = roomCryptoKeys[roomId];
    if (!key) return; // ignorado (sala fechada pelo user)
    
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

      // MsgId p/ deduplicar Gun.js vs MQTT (fallback para os antigos)
      const msgId = data.msgId || `old_${data.ts}_${Math.random().toString(36).slice(2, 8)}`;

      if (await Storage.hasMessage(msgId)) return; // Já processada

      const text = await Crypto.decryptMessage(key, data.ciphertext, data.iv);

      const msg = {
        id:        msgId,
        roomId,
        sender:    data.sender,
        text,
        timestamp: data.ts || Date.now(),
        type:      'text',
        isMine:    data.sender === currentUser.username,
      };

      await Storage.saveMessage(roomId, msg);

      if (roomId === currentRoom) {
        _queueRoomRender(roomId);
        _publishPresence(roomId, 'online');
      } else {
        unreadCounts[roomId] = (unreadCounts[roomId] || 0) + 1;
        UI.setRoomBadge(roomId, unreadCounts[roomId]);
        
        // Notifica se for mensagem muito recente e não for do usuário
        const isRecent = (Date.now() - (data.ts || Date.now())) < 5000;
        if (data.sender !== currentUser.username && isRecent) {
          Notifications.notifyNewMessage(data.sender, text, roomId, roomId);
        }
      }
    } catch (e) {
      // Falha ao decifrar (outra sala ou lixo da rede)
    }
  }

  function _onPresence(roomId, payload) {
    try {
      const data = JSON.parse(payload);
      if (!onlineInRoom[roomId]) onlineInRoom[roomId] = new Set();
      if (data.status === 'online') onlineInRoom[roomId].add(data.username);
      else                          onlineInRoom[roomId].delete(data.username);
      if (roomId === currentRoom) UI.updateOnlineList(Array.from(onlineInRoom[roomId]));
    } catch (_) {}
  }

  function _onTyping(roomId, payload) {
    try {
      const data = JSON.parse(payload);
      if (data.username === currentUser.username) return;
      if (roomId !== currentRoom) return;
      UI.showTyping(data.username);
      clearTimeout(typingTimers[data.username]);
      typingTimers[data.username] = setTimeout(() => UI.hideTyping(data.username), CONFIG.app.typingTimeout);
    } catch (_) {}
  }

  function _onGlobalPresence(username, payload) {
    try {
      const data = JSON.parse(payload);
      UI.updateGlobalUserStatus(username, data.status);
    } catch (_) {}
  }

  // ── Recepção de arquivo por chunks ────────────────────────────────────────
  async function _onFileChunk(roomId, transferId, payload) {
    const key = roomCryptoKeys[roomId];
    if (!key) return;
    try {
      const data = JSON.parse(payload);

      if (data.type === 'meta') {
        fileChunks[transferId] = {
          meta:     data,
          chunks:   new Array(data.totalChunks).fill(null),
          received: 0,
        };
        if (data.sender !== currentUser.username) {
          UI.showFileReceiving(transferId, data.filename, data.fileSize);
        }
        return;
      }

      if (data.type === 'chunk') {
        const fc = fileChunks[transferId];
        if (!fc) return;

        const decrypted = await Crypto.decryptMessage(key, data.ciphertext, data.iv);
        fc.chunks[data.index] = decrypted;
        fc.received++;

        const progress = Math.round((fc.received / fc.meta.totalChunks) * 100);
        if (fc.meta.sender !== currentUser.username) {
          UI.updateFileProgress(transferId, progress);
        }

        if (fc.received === fc.meta.totalChunks) {
          // Remontar arquivo
          const fullBase64 = fc.chunks.join('');
          const binary = atob(fullBase64);
          const bytes  = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: fc.meta.mimeType || 'application/octet-stream' });

          await Storage.saveFile(transferId, blob, fc.meta);

          const msg = {
            roomId,
            sender:     fc.meta.sender,
            text:       fc.meta.filename,
            timestamp:  fc.meta.ts || Date.now(),
            type:       'file',
            transferId,
            fileName:   fc.meta.filename,
            mimeType:   fc.meta.mimeType,
            fileSize:   fc.meta.fileSize,
            isMine:     fc.meta.sender === currentUser.username,
          };
          await Storage.saveMessage(roomId, msg);

          if (roomId === currentRoom) {
            UI.completeFileReceiving(transferId, msg);
          } else if (fc.meta.sender !== currentUser.username) {
            unreadCounts[roomId] = (unreadCounts[roomId] || 0) + 1;
            UI.setRoomBadge(roomId, unreadCounts[roomId]);
            Notifications.notifyFileReceived(fc.meta.sender, fc.meta.filename, roomId);
          }

          delete fileChunks[transferId];
        }
      }
    } catch (e) {
      console.error('[File] Erro ao processar chunk:', e);
    }
  }

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  async function sendMessage(roomId, text) {
    if (_isLocked) return;
    const key = roomCryptoKeys[roomId];
    if (!key) {
      // Se não tem chave (expirou/bloqueou), pede senha
      UI.showModal('join-room-modal');
      return;
    }
    if (!text.trim()) return;

    const { iv, ciphertext } = await Crypto.encryptMessage(key, text.trim());
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const payloadObj = {
      msgId,
      sender:     currentUser.username,
      iv,
      ciphertext,
      ts:         Date.now(),
    };
    
    // MQTT envia como string
    mqttClient.publish(CONFIG.topics.roomMessages(roomId), JSON.stringify(payloadObj), { qos: 1 });
    
    // Gun.js espalha como payload JSON na rede P2P durável
    Storage.syncMessageP2P(roomId, payloadObj);
  }

  // ── Enviar indicador de digitando ─────────────────────────────────────────
  function sendTyping(roomId) {
    if (!mqttClient) return;
    const payload = JSON.stringify({ username: currentUser.username, ts: Date.now() });
    mqttClient.publish(CONFIG.topics.roomTyping(roomId), payload, { qos: 0 });
  }

  // ── Enviar arquivo ────────────────────────────────────────────────────────
  async function sendFile(roomId, file) {
    if (_isLocked) return;
    const key = roomCryptoKeys[roomId];
    if (!key) return;

    if (file.size > CONFIG.app.maxFileSizeBytes) {
      throw new Error(`Arquivo muito grande. Limite: ${CONFIG.app.maxFileSizeBytes / 1024 / 1024}MB`);
    }

    const transferId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const CHUNK      = CONFIG.app.chunkSizeBytes;

    // Ler arquivo como base64
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = e => res(e.target.result.split(',')[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    // Dividir em chunks
    const chunks = [];
    for (let i = 0; i < base64.length; i += CHUNK) chunks.push(base64.slice(i, i + CHUNK));

    // Mostrar progresso de envio na UI (usa o mesmo transferId)
    UI.showFileSendProgress(transferId, file.name, 0);

    // Publicar meta
    const meta = {
      type:        'meta',
      transferId,
      filename:    file.name,
      mimeType:    file.type || 'application/octet-stream',
      fileSize:    file.size,
      totalChunks: chunks.length,
      sender:      currentUser.username,
      ts:          Date.now(),
    };
    mqttClient.publish(CONFIG.topics.roomFile(roomId, transferId), JSON.stringify(meta), { qos: 1 });

    // Publicar chunks
    for (let i = 0; i < chunks.length; i++) {
      const { iv, ciphertext } = await Crypto.encryptMessage(key, chunks[i]);
      const chunkPayload = JSON.stringify({ type: 'chunk', transferId, index: i, iv, ciphertext });
      mqttClient.publish(CONFIG.topics.roomFile(roomId, transferId), chunkPayload, { qos: 1 });
      UI.updateFileSendProgress(transferId, Math.round(((i + 1) / chunks.length) * 100));
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 80));
    }

    UI.completeFileSend(transferId);
  }

  // ── Trocar de sala ────────────────────────────────────────────────────────
  async function switchRoom(roomId) {
    if (_isLocked || currentRoom === roomId) return;

    // Se não temos a chave criptográfica (sala salva mas senha não foi re-digitada),
    // abrir o modal de entrada pré-preenchido com o ID da sala.
    if (!roomCryptoKeys[roomId]) {
      UI.showRejoinModal(roomId);
      return;
    }

    if (currentRoom) _publishPresence(currentRoom, 'offline');
    currentRoom = roomId;

    // Zerar unread
    const wasUnread = unreadCounts[roomId] || 0;
    if (wasUnread > 0) Notifications.clearUnread(wasUnread);
    unreadCounts[roomId] = 0;
    UI.setRoomBadge(roomId, 0);
    Notifications.restoreTitle();

    // Carregar histórico
    const msgs = await Storage.getMessages(roomId, CONFIG.app.historyLimit);
    UI.renderChatRoom(roomId, msgs, Array.from(onlineInRoom[roomId] || []));

    _publishPresence(roomId, 'online');
    UI.highlightRoom(roomId);
  }

  // ── Presença ──────────────────────────────────────────────────────────────
  function _publishPresence(roomId, status) {
    if (!mqttClient) return;
    mqttClient.publish(
      CONFIG.topics.roomPresence(roomId),
      JSON.stringify({ username: currentUser.username, status, ts: Date.now() }),
      { qos: 0, retain: false }
    );
    mqttClient.publish(
      CONFIG.topics.userPresence(currentUser.username),
      JSON.stringify({ username: currentUser.username, status, ts: Date.now() }),
      { qos: 0, retain: true }
    );
  }

  // ── Vigilantes de Rede e Saúde ───────────────────────────────────────────
  function _initNetworkMonitoring() {
    // Escuta quando o Wi-Fi ou cabo de rede volta fisicamente
    window.addEventListener('online', () => {
      if (mqttClient && !mqttClient.connected) {
        UI.setConnectionStatus('reconnecting');
        mqttClient.reconnect();
      }
    });

    // Quando o usuário volta a focar no App (Alt+Tab), verifica se caiu
    window.addEventListener('focus', () => {
      if (mqttClient && !mqttClient.connected) {
        mqttClient.reconnect();
      }
    });
  }

  function _startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      if (!mqttClient) return;

      // Sinal Fantasma: Mantém a conexão TCP ocupada para não dropar
      mqttClient.publish('keepcalm/ping', '1', { qos: 0 });

      // Forçar status no UI se o cliente do MQTT achar que está desconectado
      if (!mqttClient.connected) {
        UI.setConnectionStatus('offline');
      }

      if (currentRoom && mqttClient.connected) {
        _publishPresence(currentRoom, 'online');
      }
    }, 15000); // 15 segundos para manter firme 24/7
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function logout() {
    clearInterval(heartbeatTimer);
    if (mqttClient) {
      if (currentRoom) _publishPresence(currentRoom, 'offline');
      mqttClient.publish(
        CONFIG.topics.userPresence(currentUser.username),
        JSON.stringify({ username: currentUser.username, status: 'offline', ts: Date.now() }),
        { qos: 0, retain: true }
      );
      mqttClient.end(true);
      mqttClient = null;
    }
    currentUser   = null;
    currentRoom   = null;
    rooms         = [];
    roomCryptoKeys = {};
    onlineInRoom  = {};
    unreadCounts  = {};
    Storage.clearUser();
    Notifications.resetAll();
    UI.showLogin();
  }

  // ── Getters ───────────────────────────────────────────────────────────────
  function getState() {
    return { currentUser, currentRoom, rooms, onlineInRoom, unreadCounts };
  }

  function isInRoom(roomId) {
    return !!roomCryptoKeys[roomId];
  }

  function startHeartbeat() { _startHeartbeat(); }

  // ── Lock / Unlock ─────────────────────────────────────────────────────────
  function lock() {
    _isLocked = true;
    // O PULO DO GATO: Limpamos as chaves da memória RAM
    // Isso garante que mesmo que alguém acesse o PC, não há nada legível
    roomCryptoKeys = {};
    UI.renderRoomsList(rooms, unreadCounts);
  }

  function unlock(pw) {
    if (pw === _accessPw) {
      _isLocked = false;
      return true;
    }
    return false;
  }

  return {
    init,
    login,
    logout,
    joinRoom,
    leaveRoom,
    switchRoom,
    sendMessage,
    sendFile,
    sendTyping,
    startHeartbeat,
    getState: () => ({ currentUser, currentRoom, rooms, unreadCounts, roomCryptoKeys, isLocked: _isLocked }),
    isInRoom,
    lock,
    unlock
  };
})();
