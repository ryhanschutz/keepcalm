// KeepCalm — Configuração do Broker MQTT
'use strict';

const CONFIG = {
  mqtt: {
    host: '8499505b5a944d7fb9741e0ab74b8610.s1.eu.hivemq.cloud',
    port: 8884,
    url: 'wss://8499505b5a944d7fb9741e0ab74b8610.s1.eu.hivemq.cloud:8884/mqtt',
    username: 'admin',
    password: 'Server123',
    keepalive: 60,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
  },
  app: {
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
    chunkSizeBytes: 10240,             // 10KB por chunk
    heartbeatInterval: 25000,          // 25 segundos
    historyLimit: 200,                 // mensagens por sala
    typingTimeout: 3000,
  },
  topics: {
    roomMessages: (roomId) => `keepcalm/rooms/${roomId}/messages`,
    roomPresence: (roomId) => `keepcalm/rooms/${roomId}/presence`,
    roomTyping: (roomId)   => `keepcalm/rooms/${roomId}/typing`,
    roomFiles: (roomId)    => `keepcalm/rooms/${roomId}/files/+`,
    roomFile: (roomId, id) => `keepcalm/rooms/${roomId}/files/${id}`,
    userPresence: (user)   => `keepcalm/presence/${user}`,
  }
};
