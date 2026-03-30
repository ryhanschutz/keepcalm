// KeepCalm — Configuração do Broker MQTT + GunDB
// Valores padrão (placeholders) são substituídos pelo GitHub Actions em build-time.
// Em desenvolvimento local, config.secret.js (gitignored) sobrescreve estes valores.
'use strict';

const CONFIG = {
  mqtt: {
    host:            '__MQTT_HOST__',
    port:            __MQTT_PORT__,
    url:             'wss://__MQTT_HOST__:__MQTT_PORT__/mqtt',
    username:        '__MQTT_USERNAME__',
    password:        '__MQTT_PASSWORD__',
    keepalive:       60,
    reconnectPeriod: 5000,
    connectTimeout:  15000,
  },
  app: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
    chunkSizeBytes:   10240,            // 10KB por chunk
    heartbeatInterval: 25000,           // 25 segundos
    historyLimit:     200,              // mensagens por sala
    typingTimeout:    3000,
  },
  gun: {
    // Relays GunDB. Adicione seu relay privado aqui para máxima privacidade.
    // Todos os dados armazenados são ciphertexts AES-256-GCM — os relays nunca veem conteúdo.
    relays: [
      'https://gun-manhattan.herokuapp.com/gun',
      'https://relay.peer.ooo/gun',
    ]
  },
  topics: {
    roomMessages: (roomId) => `keepcalm/rooms/${roomId}/messages`,
    roomPresence: (roomId) => `keepcalm/rooms/${roomId}/presence`,
    roomTyping:   (roomId) => `keepcalm/rooms/${roomId}/typing`,
    roomFiles:    (roomId) => `keepcalm/rooms/${roomId}/files/+`,
    roomFile: (roomId, id) => `keepcalm/rooms/${roomId}/files/${id}`,
    userPresence: (user)   => `keepcalm/presence/${user}`,
  }
};

// ── Override de Desenvolvimento Local ────────────────────────────────────────
// Se config.secret.js foi carregado (gitignored), mescla as credenciais reais.
// Em produção, os placeholders acima são substituídos pelo GitHub Actions.
if (typeof KC_SECRET !== 'undefined' && KC_SECRET) {
  if (KC_SECRET.host)     CONFIG.mqtt.host     = KC_SECRET.host;
  if (KC_SECRET.port)     CONFIG.mqtt.port     = KC_SECRET.port;
  if (KC_SECRET.url)      CONFIG.mqtt.url      = KC_SECRET.url;
  if (KC_SECRET.username) CONFIG.mqtt.username = KC_SECRET.username;
  if (KC_SECRET.password) CONFIG.mqtt.password = KC_SECRET.password;
  if (KC_SECRET.gunRelays && KC_SECRET.gunRelays.length > 0) {
    CONFIG.gun.relays = KC_SECRET.gunRelays;
  }
}
