// KeepCalm — Storage (IndexedDB + GunDB descentralizado)
// Modo Fantasma: senhas de sessão jamais persistidas no disco.
// GunDB armazena apenas ciphertexts AES-256-GCM — relays nunca veem conteúdo legível.
// IDs de sala são hasheados antes de ir para o Gun (nenhum relay sabe os nomes das salas).
'use strict';

const Storage = (() => {
  let db  = null;
  let gun = null;
  const DB_NAME    = 'keepcalm_db';
  const DB_VERSION = 1;

  // ── Hash do roomId para uso no Gun (privacidade do nome da sala) ──────────
  // Os relays Gun veem apenas o hash SHA-256, nunca o ID real da sala.
  async function _hashRoomId(roomId) {
    const buf  = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kc_room::${roomId}`));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Inicialização ─────────────────────────────────────────────────────────
  async function init() {
    // Conectar ao GunDB usando os relays definidos em CONFIG
    if (window.Gun) {
      const relays = (CONFIG && CONFIG.gun && CONFIG.gun.relays) || [];
      gun = relays.length > 0 ? Gun(relays) : Gun(); // sem server = só localStorage/P2P local
      console.info('[Gun] Conectado a', relays.length > 0 ? relays : 'modo local');
    }

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('messages')) {
          const s = d.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
          s.createIndex('roomId',    'roomId',    { unique: false });
          s.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!d.objectStoreNames.contains('files')) {
          d.createObjectStore('files', { keyPath: 'transferId' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(); };
      req.onerror   = ()  => reject(new Error('Falha ao abrir banco local.'));
    });
  }

  // ── Mensagens (IndexedDB local) ───────────────────────────────────────────
  async function hasMessage(id) {
    if (!id) return false;
    return new Promise((resolve) => {
      const r = db.transaction('messages', 'readonly').objectStore('messages').get(id);
      r.onsuccess = () => resolve(!!r.result);
      r.onerror   = () => resolve(false);
    });
  }

  async function saveMessage(roomId, msg) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readwrite');
      const s  = tx.objectStore('messages');
      const r  = s.put({ roomId, ...msg, savedAt: Date.now() });
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
  }

  async function getMessages(roomId, limit = 200) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('messages', 'readonly');
      const idx = tx.objectStore('messages').index('roomId');
      const r   = idx.getAll(IDBKeyRange.only(roomId));
      r.onsuccess = () => resolve(
        (r.result || []).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(-limit)
      );
      r.onerror = () => reject(r.error);
    });
  }

  async function clearMessages(roomId) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('messages', 'readwrite');
      const s   = tx.objectStore('messages');
      const idx = s.index('roomId');
      const r   = idx.getAllKeys(IDBKeyRange.only(roomId));
      r.onsuccess = () => {
        const keys = r.result || [];
        if (!keys.length) { resolve(); return; }
        let done = 0;
        keys.forEach(k => {
          const d = s.delete(k);
          d.onsuccess = () => { if (++done === keys.length) resolve(); };
          d.onerror   = () => reject(d.error);
        });
      };
      r.onerror = () => reject(r.error);
    });
  }

  // ── Sincronismo P2P Descentralizado (GunDB) ───────────────────────────────
  // Publica o payload cifrado na rede Gun usando o HASH do roomId como chave.
  // Relays externos veem apenas: hash_da_sala → { msgId: ciphertext_blob }
  // Nenhum conteúdo legível sai do dispositivo.
  async function syncMessageP2P(roomId, payloadObj) {
    if (!gun || !payloadObj.msgId) return;
    try {
      const roomHash = await _hashRoomId(roomId);
      gun.get('kc_v3').get(roomHash).get(payloadObj.msgId).put(JSON.stringify(payloadObj));
    } catch (e) {
      console.warn('[Gun] Erro ao sincronizar:', e);
    }
  }

  // Escuta o histórico descentralizado ao entrar numa sala.
  // Ignora mensagens que já existem no IndexedDB local (deduplicação).
  async function listenToRoomHistoryP2P(roomId, callback) {
    if (!gun) return;
    try {
      const roomHash = await _hashRoomId(roomId);
      gun.get('kc_v3').get(roomHash).map().once((dataStr) => {
        try {
          if (typeof dataStr === 'string') callback(JSON.parse(dataStr));
        } catch (_) {}
      });
    } catch (e) {
      console.warn('[Gun] Erro ao escutar histórico:', e);
    }
  }

  // ── Arquivos (IndexedDB local) ────────────────────────────────────────────
  async function saveFile(transferId, blob, meta) {
    return new Promise((resolve, reject) => {
      const r = db.transaction('files', 'readwrite').objectStore('files')
                  .put({ transferId, blob, meta, savedAt: Date.now() });
      r.onsuccess = () => resolve();
      r.onerror   = () => reject(r.error);
    });
  }

  async function getFile(transferId) {
    return new Promise((resolve, reject) => {
      const r = db.transaction('files', 'readonly').objectStore('files').get(transferId);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror   = () => reject(r.error);
    });
  }

  // ── Usuário (Phantom Mode) ────────────────────────────────────────────────
  function setUser(data)  { /* Não salva o nome */ }
  function getUser()      { return null; }
  function clearUser()    { /* n/a */ }

  // No Phantom Mode, as identidades são efémeras. Não guardamos hashes de sessão.
  async function verifyUser(name) {
    return Promise.resolve();
  }

  // ── Sessões / Salas ───────────────────────────────────────────────────────
  // Opção B: Lembra IDs das salas entre sessões, mas NUNCA as senhas.
  function setRooms(rooms) {
    localStorage.setItem('kc_rooms', JSON.stringify(rooms));
  }
  function getRooms() {
    try { return JSON.parse(localStorage.getItem('kc_rooms')) || []; } catch { return []; }
  }

  // Senhas vivem APENAS na RAM durante a sessão. Zero persistência no disco.
  async function saveSessionPassword(roomId, password) { /* no-op: Opção B */ }
  async function getSessionPassword(roomId)            { return null; }
  function      removeSessionPassword(roomId)          { /* no-op: Opção B */ }

  // ── Limpar tudo ───────────────────────────────────────────────────────────
  async function clearEverything() {
    return new Promise((resolve, reject) => {
      localStorage.clear();
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(new Error('Falha ao apagar banco local.'));
    });
  }

  return {
    init,
    // Mensagens
    saveMessage, getMessages, clearMessages, hasMessage,
    // P2P descentralizado (GunDB com IDs hasheados)
    syncMessageP2P, listenToRoomHistoryP2P,
    // Arquivos
    saveFile, getFile,
    // Usuário
    setUser, getUser, clearUser, verifyUser,
    // Sessões
    setRooms, getRooms,
    saveSessionPassword, getSessionPassword, removeSessionPassword,
    clearEverything
  };
})();
