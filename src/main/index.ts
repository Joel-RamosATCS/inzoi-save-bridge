import { BrowserWindow, app, clipboard, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import type { AppSettings, IncomingResponse, TransferRequest } from '@shared/types'
import { AppController } from './controller'
import { createMainWindow, installAppMenu } from './window'

app.setName('inZOI Save Bridge')
if (process.platform === 'win32') app.setAppUserModelId('com.inzoi.savebridge')

let mainWindow: BrowserWindow | null = null
let controller: AppController | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  installAppMenu()

  controller = new AppController(() => mainWindow)

  try {
    await controller.init()
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'inZOI Save Bridge',
      message: 'The app could not start.',
      detail: (error as Error).message
    })
    app.quit()
    return
  }

  registerIpc(controller)

  mainWindow = createMainWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const capturePath = process.env.INZOI_CAPTURE
  if (capturePath && mainWindow) {
    const captureWindow = mainWindow
    captureWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const width = Number(process.env.INZOI_CAPTURE_WIDTH)
          const height = Number(process.env.INZOI_CAPTURE_HEIGHT)
          if (Number.isInteger(width) && Number.isInteger(height) && width > 800 && height > 600) {
            captureWindow.setContentSize(width, height)
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
          const page = process.env.INZOI_CAPTURE_PAGE
          if (page) {
            await captureWindow.webContents.executeJavaScript(
              `(() => { const target = [...document.querySelectorAll('.nav-item')].find((button) => button.textContent?.toLowerCase().includes(${JSON.stringify(page.toLowerCase())})); target?.click(); })()`
            )
            await new Promise((resolve) => setTimeout(resolve, 650))
          }
          if (process.env.INZOI_CAPTURE_JS) {
            await captureWindow.webContents.executeJavaScript(process.env.INZOI_CAPTURE_JS)
            await new Promise((resolve) => setTimeout(resolve, 700))
          }
          const captureDelay = Number(process.env.INZOI_CAPTURE_DELAY)
          if (Number.isFinite(captureDelay) && captureDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, captureDelay))
          }
          if (process.env.INZOI_CAPTURE_SCROLL) {
            const mode = process.env.INZOI_CAPTURE_SCROLL
            await captureWindow.webContents.executeJavaScript(
              `(() => { const el = document.querySelector('.app-scroll'); if (!el) return; const value = ${JSON.stringify(mode)}; el.scrollTo({ top: value === 'bottom' ? el.scrollHeight : Number(value) || 0, behavior: 'instant' }); })()`
            )
            await new Promise((resolve) => setTimeout(resolve, 450))
          }
          const theme = process.env.INZOI_CAPTURE_THEME
          if (theme === 'light' || theme === 'dark') {
            await captureWindow.webContents.executeJavaScript(
              `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.documentElement.style.colorScheme = ${JSON.stringify(theme)};`
            )
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          const preset = process.env.INZOI_CAPTURE_PRESET
          if (preset) {
            await captureWindow.webContents.executeJavaScript(
              `document.documentElement.dataset.glassPreset = ${JSON.stringify(preset)};`
            )
            await new Promise((resolve) => setTimeout(resolve, 250))
          }
          if (process.env.INZOI_METRICS === '1') {
            const metrics = await captureWindow.webContents.executeJavaScript(`(() => {
              const rect = (selector) => {
                const element = document.querySelector(selector)
                if (!element) return null
                const box = element.getBoundingClientRect()
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }
              }
              return {
                viewport: { w: innerWidth, h: innerHeight },
                shell: rect('.shell'),
                header: rect('.app-header'),
                hero: rect('.hero'),
                heroTitle: rect('.hero h1'),
                heroCopy: rect('.hero-copy'),
                heroArt: rect('.hero-art-wrap'),
                networkBadge: rect('.network-badge'),
                artSvg: rect('.hero-art'),
                device: rect('.device-card'),
                saves: rect('.saves-section'),
                card: rect('.save-card'),
                panel: rect('.ready-panel'),
                footer: rect('.transfer-footer'),
                cta: rect('.transfer-cta')
              }
            })()`)
            console.log('[metrics]', JSON.stringify(metrics))
          }
          const image = await captureWindow.webContents.capturePage()
          await fs.writeFile(capturePath, image.toPNG())
          console.log(`[capture] wrote ${capturePath}`)
        } catch (error) {
          console.error('[capture] failed', error)
        }
        if (process.env.INZOI_CAPTURE_QUIT === '1') app.quit()
      }, 2400)
    })
  }

  app.on('activate', () => {
    if (!mainWindow) {
      mainWindow = createMainWindow()
      mainWindow.on('closed', () => {
        mainWindow = null
      })
    } else {
      mainWindow.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc(instance: AppController): void {
  ipcMain.handle('app:bootstrap', () => instance.getBootstrap())
  ipcMain.handle('app:refresh', () => instance.refresh())
  ipcMain.handle('saves:scan', () => instance.scanSaves())
  ipcMain.handle('source:choose', () => instance.chooseSourceFolder())
  ipcMain.handle('source:use-candidate', (_event, candidateId: unknown) => {
    if (typeof candidateId !== 'string') throw new Error('Invalid folder choice.')
    return instance.useSourceCandidate(candidateId)
  })
  ipcMain.handle('source:set', (_event, folder: unknown) => {
    if (typeof folder !== 'string' || !folder.trim()) throw new Error('Invalid folder.')
    return instance.setSourceFolder(folder)
  })
  ipcMain.handle('source:reset', () => instance.resetSourceFolder())
  ipcMain.handle('destination:choose', () => instance.chooseDestinationFolder())
  ipcMain.handle('shell:open', (_event, target: unknown) => {
    if (typeof target !== 'string') throw new Error('Invalid path.')
    return instance.openPath(target)
  })
  ipcMain.handle('shell:reveal', (_event, target: unknown) => {
    if (typeof target !== 'string') throw new Error('Invalid path.')
    return instance.revealPath(target)
  })
  ipcMain.handle('shell:full-disk-access', () => instance.openFullDiskAccess())
  ipcMain.handle('peers:get', () => instance.getPeers())
  ipcMain.handle('peers:refresh', () => instance.refreshPeers())
  ipcMain.handle('peers:connect', (_event, host: unknown, port: unknown) => {
    if (typeof host !== 'string' || !host.trim() || host.length > 255) {
      throw new Error('Enter a valid IP address or hostname.')
    }
    const numericPort = Number(port)
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      throw new Error('Enter a valid port.')
    }
    return instance.connectManually(host.trim(), numericPort)
  })
  ipcMain.handle('peers:select', (_event, instanceId: unknown) => {
    if (instanceId !== null && typeof instanceId !== 'string') {
      throw new Error('Invalid device.')
    }
    return instance.selectPeer(instanceId)
  })
  ipcMain.handle('settings:update', (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings.')
    return instance.updateSettings(patch as Partial<AppSettings>)
  })
  ipcMain.handle('transfer:start', (_event, request: unknown) => {
    if (!request || typeof request !== 'object') throw new Error('Invalid transfer.')
    const candidate = request as TransferRequest
    if (!Array.isArray(candidate.saveIds) || !candidate.saveIds.every((id) => typeof id === 'string')) {
      throw new Error('Invalid save selection.')
    }
    if (typeof candidate.peerInstanceId !== 'string') throw new Error('Invalid destination.')
    return instance.startTransfer({
      saveIds: candidate.saveIds,
      peerInstanceId: candidate.peerInstanceId,
      backup: Boolean(candidate.backup)
    })
  })
  ipcMain.handle('transfer:cancel', () => instance.cancelTransfer())
  ipcMain.handle('incoming:respond', (_event, requestId: unknown, response: unknown) => {
    if (typeof requestId !== 'string') throw new Error('Invalid request.')
    const parsed = response as IncomingResponse
    if (!parsed || typeof parsed.accept !== 'boolean') throw new Error('Invalid response.')
    return instance.respondIncoming(requestId, {
      accept: parsed.accept,
      backup: Boolean(parsed.backup)
    })
  })
  ipcMain.handle('history:clear', () => instance.clearHistory())
  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 4096) throw new Error('Invalid clipboard text.')
    clipboard.writeText(text)
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
