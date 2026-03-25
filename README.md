# MQTT CyberChat - Romeobravo

Chat privado e minimalista baseado em MQTT para comunicação em tempo real.

## Como hospedar no GitHub Pages:

1. **Crie um Repositório**: No seu GitHub, crie um novo repositório (ex: `chat-privado`).
2. **Suba os arquivos**:
   - Você pode simplesmente arrastar os arquivos da pasta `dist` (após o build) para o repositório.
   - Ou usar o comando:
     ```bash
     npm run build
     # Suba o conteúdo da pasta /dist para o branch 'gh-pages' ou 'main'
     ```
3. **Ative o Pages**:
   - Vá em `Settings` > `Pages`.
   - Em `Build and deployment`, selecione o branch onde você subiu os arquivos (geralmente `main` ou `gh-pages`).
   - Clique em `Save`.

4. **Pronto!** Seu chat estará disponível em `https://seu-usuario.github.io/seu-repositorio/`.

## Configurações Atuais:
- **Broker**: HiveMQ Cloud (Privado)
- **Canal Padrão**: `romeobravo`
- **Porta**: 8884 (WebSockets WSS)
