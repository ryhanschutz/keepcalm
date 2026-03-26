// KeepCalm — Storage (Device-Key + IndexedDB)
// Sessões salvas com chave de dispositivo local (AES-GCM, transparente ao usuário)
'use strict';

const Storage = (() => {
  let db = null;
  const DB_NAME = 'keepcalm_db';
  const DB_VERSION = 1;

  // ── IndexedDB ─────────────────────────────────────────────────────────────
  async function init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('messages')) {
          const s = d.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
          s.createIndex('roomId', 'roomId', { unique: false });
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

  // ── Mensagens ─────────────────────────────────────────────────────────────
  async function saveMessage(roomId, msg) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages', 'readwrite');
      const s  = tx.objectStore('messages');
      const r  = s.add({ roomId, ...msg, savedAt: Date.now() });
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

  // ── Arquivos ──────────────────────────────────────────────────────────────
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

  // ── Chave de dispositivo (gerada uma vez, salva em localStorage) ──────────
  // Usada para cifrar as senhas das sessões localmente, de forma transparente.
  async function _getDeviceKey() {
    let raw = localStorage.getItem('kc_devkey');
    if (!raw) {
      const keyBytes = window.crypto.getRandomValues(new Uint8Array(32));
      raw = btoa(String.fromCharCode(...keyBytes));
      localStorage.setItem('kc_devkey', raw);
    }
    const binary = atob(raw);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return await window.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function _encrypt(text) {
    const key = await _getDeviceKey();
    const iv  = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    const buf = new Uint8Array(12 + enc.byteLength);
    buf.set(iv, 0);
    buf.set(new Uint8Array(enc), 12);
    return btoa(String.fromCharCode(...buf));
  }

  async function _decrypt(b64) {
    const key = await _getDeviceKey();
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const iv  = buf.slice(0, 12);
    const enc = buf.slice(12);
    const dec = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
    return new TextDecoder().decode(dec);
  }

  // ── Usuário ───────────────────────────────────────────────────────────────
  function setUser(data)  { localStorage.setItem('kc_user', JSON.stringify(data)); }
  function getUser()      { try { return JSON.parse(localStorage.getItem('kc_user')); } catch { return null; } }
  function clearUser()    { localStorage.removeItem('kc_user'); }

  // ── Sessões (rooms) ───────────────────────────────────────────────────────
  function setRooms(rooms) { localStorage.setItem('kc_rooms', JSON.stringify(rooms)); }
  function getRooms()      { try { return JSON.parse(localStorage.getItem('kc_rooms')) || []; } catch { return []; } }

  // Salva senha de sessão cifrada com chave de dispositivo
  async function saveSessionPassword(roomId, password) {
    const map = _getSessionPassMap();
    map[roomId] = await _encrypt(password);
    localStorage.setItem('kc_sessions', JSON.stringify(map));
  }

  // Recupera senha de sessão
  async function getSessionPassword(roomId) {
    const map = _getSessionPassMap();
    if (!map[roomId]) return null;
    try { return await _decrypt(map[roomId]); } catch { return null; }
  }

  function removeSessionPassword(roomId) {
    const map = _getSessionPassMap();
    delete map[roomId];
    localStorage.setItem('kc_sessions', JSON.stringify(map));
  }

  function _getSessionPassMap() {
    try { return JSON.parse(localStorage.getItem('kc_sessions')) || {}; } catch { return {}; }
  }

  return {
    init,
    // Mensagens
    saveMessage, getMessages, clearMessages,
    // Arquivos
    saveFile, getFile,
    // Usuário
    setUser, getUser, clearUser,
    // Sessões
    setRooms, getRooms,
    saveSessionPassword, getSessionPassword, removeSessionPassword,
  };
})();
