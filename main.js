import { app, BrowserWindow, dialog } from 'electron';
import localtunnel from 'localtunnel';
import path from 'path';
import { fileURLToPath } from 'url';

// Inicia tu servidor Express en segundo plano
import './server.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    // icon: path.join(__dirname, 'public', 'favicon.ico')
  });

  mainWindow.loadURL('http://localhost:3000');
  
  // Levantar túnel para móviles
  setupTunnel();
}

async function setupTunnel() {
  try {
    const tunnel = await localtunnel({ port: 3000, subdomain: 'barrafit360pos' });
    console.log(`=========================================`);
    console.log(`📲 Link para celulares: ${tunnel.url}`);
    console.log(`=========================================`);
    
    // Opcional: Mostrar un mensaje en la ventana cuando inicie el túnel
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Conexión Móvil Lista',
      message: `El sistema está listo para ser usado en celulares.\n\nAbre este enlace en tu teléfono:\n${tunnel.url}`
    });

    tunnel.on('close', () => {
      console.log('Tunnel cerrado');
    });
  } catch (err) {
    console.error('Error iniciando localtunnel:', err);
    dialog.showErrorBox('Error de Conexión', 'No se pudo conectar el sistema a internet para el celular. Verifica tu conexión.');
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
