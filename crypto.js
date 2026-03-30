// KeepCalm — Módulo de Criptografia (AES-256-GCM + ECDH P-256 + PBKDF2)
'use strict';

const Crypto = (() => {
  const subtle = window.crypto.subtle;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ── Derivação de chave de sala (PBKDF2 → AES-256-GCM) ────────────────────
  // Cada sala tem um ID público e uma senha. A chave AES é derivada deles.
  // O broker jamais vê o conteúdo: só ciphertext trafega.
  async function deriveRoomKey(roomId, roomPassword) {
    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(roomPassword),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const salt = new TextEncoder().encode(`keepcalm_room_salt::${roomId}`);
    return await subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ── Cifrar mensagem (AES-256-GCM) ─────────────────────────────────────────
  async function encryptMessage(roomKey, plaintext) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, roomKey, encoded);
    return {
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(ciphertext)
    };
  }

  // ── Decifrar mensagem (AES-256-GCM) ───────────────────────────────────────
  async function decryptMessage(roomKey, ciphertextB64, ivB64) {
    const iv = base64ToBuffer(ivB64);
    const ciphertext = base64ToBuffer(ciphertextB64);
    const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, roomKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  }

  // ── Cifrar dados binários (base64 string → encrypted base64) ─────────────
  async function encryptBinary(roomKey, base64String) {
    return await encryptMessage(roomKey, base64String);
  }

  async function decryptBinary(roomKey, ciphertextB64, ivB64) {
    return await decryptMessage(roomKey, ciphertextB64, ivB64);
  }

  return {
    deriveRoomKey,
    encryptMessage,
    decryptMessage,
    encryptBinary,
    decryptBinary,
    bufferToBase64,
    base64ToBuffer
  };
})();
