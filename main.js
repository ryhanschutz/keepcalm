const { app, BrowserWindow, powerSaveBlocker, Tray, Menu, globalShortcut } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');

// ── REDIRECIONAMENTO NINJA (Sem Rastro no %AppData%) ────────────────────────
// Se for versão portátil, guardar dados em uma pasta 'data' ao lado do .exe
const isPortable = process.env.PORTABLE_EXECUTABLE_DIR;
if (isPortable) {
  const dataPath = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'KeepCalm_Data');
  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
  app.setPath('userData', dataPath);
}

let mainWindow;
let pSB_id;
let tray      = null;
let isQuitting = false;

// ── Limpeza total de armazenamento local (RAM + disco) ────────────────────────
// Apaga localStorage, IndexedDB, cache e cookies da sessão Electron.
// Chamada pelo atalho de emergência e pelo evento de desligamento do Windows.
async function _wipeAllData() {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      await mainWindow.webContents.session.clearStorageData({
        storages: ['localstorage', 'indexeddb', 'cookies', 'cachestorage', 'serviceworkers', 'websql']
      });
    }
  } catch (e) {
    console.error('[WIPE] Erro ao limpar dados:', e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Evita que o SO congele o chat em background
    },
    // ── Título Neutro ────────────────────────────────────────────────────────
    // Aparece como "Notas" no Alt+Tab e no Gerenciador de Tarefas
    title: 'Notas'
  });

  // Verificação de atualizações apenas quando NÃO for portátil.
  // Evita requisição de rede extra que pode aparecer em logs de firewall.
  if (!isPortable) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  // Ícone na Bandeja (Tray)
  _createTray();

  // Impede que o computador entre em hibernação enquanto o processo rodar
  pSB_id = powerSaveBlocker.start('prevent-app-suspension');

  // Remove o menu de arquivos padrão (Deixa flat e minimalista)
  mainWindow.setMenuBarVisibility(false);

  // A BLINDAGEM MÁGICA: Protege contra capturas de tela e gravação
  mainWindow.setContentProtection(true);

  // Carrega nossa aplicação
  mainWindow.loadFile('index.html');

  // ── Atalho de Destruição de Emergência ───────────────────────────────────
  // Ctrl+Shift+Del: Apaga TODOS os dados locais (localStorage + IndexedDB)
  // e fecha o app imediatamente. Funciona mesmo com a janela em background.
  globalShortcut.register('CommandOrControl+Shift+Delete', async () => {
    await _wipeAllData();
    isQuitting = true;
    app.quit();
  });

  // Modo Ninja: Ao clicar no X, apenas esconde a janela para continuar recebendo mensagens
  mainWindow.on('close', function (e) {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', function () {
    globalShortcut.unregisterAll();
    mainWindow = null;
  });
}

function _createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir KeepCalm', click: () => { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Sair Completamente', click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('KeepCalm — Chat Seguro');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});

// Garante que o App saia de verdade ao desligar o PC ou forçar saída
app.on('before-quit', () => { isQuitting = true; });

// ── Desligamento do Windows (session-end) ─────────────────────────────────────
// Disparado quando o Windows é desligado, reiniciado ou o usuário faz logoff.
// Apaga todos os rastros locais antes do sistema encerrar.
app.on('session-end', async () => {
  await _wipeAllData();
});
