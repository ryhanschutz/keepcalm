const { app, BrowserWindow, powerSaveBlocker } = require('electron');
const path = require('path');

let mainWindow;
let pSB_id;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    icon: path.join(__dirname, 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false // Evita que o SO congele o chat em background
    },
    title: 'KeepCalm'
  });

  // Impede que o computador entre em hibernação enquanto o processo rodar
  pSB_id = powerSaveBlocker.start('prevent-app-suspension');

  // Remove o menu de arquivos padrão (Deixa flat e minimalista)
  mainWindow.setMenuBarVisibility(false);

  // A BLINDAGEM MÁGICA:
  // Se True, o Windows aplica "SetWindowDisplayAffinity(WDA_MONITOR)".
  // Isso intercepta OBS, Veyon, AnyDesk, Snipping Tool, TeamViewer, e as gravações do S.O.
  // resultando em um bloco negro intransponível nas capturas.
  mainWindow.setContentProtection(true);

  // Carrega nossa aplicação
  mainWindow.loadFile('index.html');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
