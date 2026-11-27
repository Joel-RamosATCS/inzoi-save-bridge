import { BrowserWindow, Menu, app, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1440, Math.max(1120, workArea.width - 48))
  const height = Math.min(955, Math.max(740, workArea.height - 48))
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 1120,
    minHeight: 740,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131019' : '#f7f5fe',
    title: 'inZOI Save Bridge',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 20, y: 21 } : undefined,
    roundedCorners: true,
    fullscreenable: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  if (!isMac) {
    window.on('maximize', () => undefined)
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (!isMac) {
    Menu.setApplicationMenu(null)
  }

  return window
}

export function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
