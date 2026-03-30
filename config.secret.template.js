// KeepCalm — Credenciais locais para desenvolvimento
// ⚠️  ESTE ARQUIVO ESTÁ NO .gitignore — NUNCA SERÁ COMMITADO
// Para produção, o GitHub Actions injeta os valores reais via Secrets.
//
// Como usar:
//   1. Copie este arquivo de `config.secret.template.js`
//   2. Salve como `config.secret.js` (ao lado deste template)
//   3. Preencha com suas credenciais reais
//   4. O app vai carregar automaticamente

const KC_SECRET = {
  host:     '8499505b5a944d7fb9741e0ab74b8610.s1.eu.hivemq.cloud',
  port:     8884,
  url:      'wss://8499505b5a944d7fb9741e0ab74b8610.s1.eu.hivemq.cloud:8884/mqtt',
  username: 'admin',
  password: 'Server123',

  // (Opcional) Relay GunDB privado. Deixe [] para usar os padrões públicos.
  // Exemplo: ['https://meuservidor.com/gun']
  gunRelays: []
};
