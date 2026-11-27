import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { APP_NAME, PROTOCOL } from '@shared/constants'
import type {
  AppSettings,
  Bootstrap,
  EngineKind,
  IncomingRequest,
  IncomingResponse,
  LocalDestination,
  Peer,
  SaveEntry,
  SaveFolderState,
  ScanResult,
  TransferProgress,
  TransferRecord,
  TransferRequest,
  TransferStartResult
} from '@shared/types'
import { demoHistory, demoPeers, demoSaves } from './demo'
import { Discovery } from './discovery'
import {
  FULL_DISK_ACCESS_URL,
  currentPlatform,
  platformVersionLabel,
  localIPv4Addresses,
  folderStateForPath,
  pickCandidateById,
  resolveLocalDestination,
  resolveSource
} from './paths'
import { resolveRustCoreBinary, rustProbePeer, warmupRustDaemon } from './rust-bridge'
import { scanSaveEntriesWithMetrics } from './saves'
import { ReceiverServer } from './server'
import { sendSaves } from './sender'
import { Store } from './store'

function emptyFolderState(): SaveFolderState {
  return {
    path: null,
    exists: false,
    readable: false,
    permissionDenied: false,
    kind: 'unknown',
    label: 'No save folder',
    platform: currentPlatform(),
    candidates: [],
    error: null
  }
}

function httpGetJson(host: string, port: number, timeoutMs = 4500): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        path: '/api/info',
        method: 'GET',
        timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs)
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
          } catch {
            reject(new Error('That address did not respond like inZOI Save Bridge.'))
          }
        })
      }
    )
    request.on('timeout', () => request.destroy(new Error('Connection timed out.')))
    request.on('error', reject)
    request.end()
  })
}

export class AppController {
  private store = new Store()
  private source: SaveFolderState = emptyFolderState()
  private saves: SaveEntry[] = []
  private engine: EngineKind = resolveRustCoreBinary() ? 'rust-native' : 'node-fallback'
  private scanDurationMs = 0.8
  private peers: Peer[] = []
  private peerRtt = new Map<string, number>()
  private probingPeers = false
  private selectedPeerId: string | null = null
  private localDestination: LocalDestination = {
    path: null,
    exists: false,
    readable: false
  }
  private discovery: Discovery
  private server: ReceiverServer
  private instanceId = crypto.randomUUID()
  private activeTransfer: AbortController | null = null
  private incoming = new Map<
    string,
    { resolve: (response: IncomingResponse) => void; timer: NodeJS.Timeout }
  >()
  private networkStarted = false
  private readonly demo = process.env.INZOI_DEMO === '1'

  constructor(private readonly getWindow: () => BrowserWindow | null) {
    this.discovery = new Discovery(
      () => ({
        instanceId: this.instanceId,
        name: this.store.getSettings().deviceName,
        platform: currentPlatform(),
        osVersion: platformVersionLabel(currentPlatform()),
        port: this.server.port || this.store.getSettings().port,
        savesPath: this.localDestination.path,
        version: app.getVersion(),
        accepting: true
      }),
      (message) => this.log(message)
    )
    this.discovery.on('peers', (peers: Peer[]) => {
      if (this.demo) return
      this.peers = peers.map((p) => ({
        ...p,
        rttMs: this.peerRtt.get(p.instanceId) ?? p.rttMs ?? null
      }))
      this.reconcileSelection()
      this.sendPeers()
      void this.probeDiscoveredPeers()
    })

    this.server = new ReceiverServer({
      info: () => ({
        app: 'inzoi-save-bridge',
        protocol: PROTOCOL,
        instanceId: this.instanceId,
        name: this.store.getSettings().deviceName,
        platform: currentPlatform(),
        savesPath: this.localDestination.path,
        version: app.getVersion(),
        accepting: true
      }),
      askBeforeAccepting: () => this.store.getSettings().askBeforeAccepting,
      requestAcceptance: (request) => this.promptIncoming(request),
      getDestination: async () => {
        const resolved = await resolveLocalDestination(this.store.getSettings())
        this.localDestination = {
          path: resolved.path,
          exists: resolved.exists,
          readable: resolved.readable
        }
        return resolved.path
      },
      onProgress: (progress) => this.send('transfer:progress', progress),
      onCompleted: (record) => {
        const history = this.store.addHistory(record)
        this.send('history:changed', history)
      },
      log: (message) => this.log(message)
    })
  }

  async init(): Promise<void> {
    await warmupRustDaemon()
    await this.store.init()
    nativeTheme.themeSource = this.store.getSettings().theme
    await this.refreshSource()
    await this.refreshLocalDestination()

    const settings = this.store.getSettings()

    if (this.demo) {
      this.peers = demoPeers()
      this.selectedPeerId = this.peers[0]?.instanceId ?? null
      this.saves = demoSaves(this.source)
      if (!this.source.readable) {
        this.source = {
          ...this.source,
          path: path.join(os.homedir(), 'Documents', 'inZOI', 'SaveGames'),
          exists: true,
          readable: true,
          label: 'Steam',
          kind: 'steam',
          error: null
        }
      }
      return
    }

    await this.startNetwork(settings)

    if (settings.manualPeerHost && settings.manualPeerPort) {
      await this.resolveManualPeer(settings.manualPeerHost, settings.manualPeerPort).catch(
        () => undefined
      )
    }
    this.reconcileSelection()
    this.sendPeers()
  }

  async getBootstrap(): Promise<Bootstrap> {
    const stored = this.store.getSettings()
    const envTheme = process.env.INZOI_CAPTURE_THEME
    const envPreset = process.env.INZOI_CAPTURE_PRESET
    const settings: AppSettings = this.demo
      ? {
          ...stored,
          deviceName: "Alex's MacBook",
          theme:
            envTheme === 'dark' || envTheme === 'light'
              ? envTheme
              : stored.theme ?? 'light',
          glassPreset:
            envPreset === 'amethyst' ||
            envPreset === 'emerald' ||
            envPreset === 'aurora' ||
            envPreset === 'obsidian'
              ? envPreset
              : stored.glassPreset ?? 'amethyst',
          backupBeforeReplacing: true
        }
      : stored
    return {
      platform: currentPlatform(),
      appVersion: app.getVersion(),
      settings,
      source: this.source,
      saves: this.demo ? demoSaves(this.source) : this.saves,
      peers: this.demo ? demoPeers() : this.peers,
      selectedPeerId: this.demo ? 'demo-windows-pc' : this.selectedPeerId,
      localDestination: this.localDestination,
      history: this.demo ? demoHistory() : this.store.getHistory(),
      dataDir: this.store.dataDir,
      receiverPort: this.demo ? settings.port : this.server.port || 0,
      localAddresses: localIPv4Addresses(),
      demo: this.demo,
      engine: this.engine,
      scanDurationMs: this.scanDurationMs
    }
  }

  async refresh(): Promise<Bootstrap> {
    await this.refreshSource()
    await this.refreshLocalDestination()
    if (!this.demo) {
      const settings = this.store.getSettings()
      if (settings.manualPeerHost && settings.manualPeerPort) {
        await this.resolveManualPeer(settings.manualPeerHost, settings.manualPeerPort).catch(
          () => undefined
        )
      }
      this.peers = this.discovery.getPeers()
      this.reconcileSelection()
      this.sendPeers()
    }
    return this.getBootstrap()
  }

  async scanSaves(): Promise<ScanResult> {
    return this.refreshSource()
  }

  async chooseSourceFolder(): Promise<ScanResult | null> {
    const window = this.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose your inZOI SaveGames folder',
      defaultPath: this.source.path ?? undefined,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory']
    }
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null
    const folder = picked.filePaths[0]
    await this.store.updateSettings({ sourceFolder: folder })
    const result = await this.scanFolder(folder, 'Custom folder', 'custom')
    this.broadcastSettings()
    return result
  }

  async useSourceCandidate(candidateId: string): Promise<ScanResult> {
    const settings = this.store.getSettings()
    const candidate = await pickCandidateById(candidateId, settings)
    if (!candidate) throw new Error('That save folder is no longer available.')
    await this.store.updateSettings({ sourceFolder: candidate.path })
    this.broadcastSettings()
    return this.scanFolder(candidate.path, candidate.label, candidate.kind)
  }

  async setSourceFolder(folder: string): Promise<ScanResult> {
    await this.store.updateSettings({ sourceFolder: folder })
    this.broadcastSettings()
    return this.scanFolder(folder, 'Custom folder', 'custom')
  }

  async resetSourceFolder(): Promise<ScanResult> {
    await this.store.updateSettings({ sourceFolder: null })
    this.broadcastSettings()
    return this.refreshSource()
  }

  async chooseDestinationFolder(): Promise<string | null> {
    const window = this.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose where incoming saves should go',
      defaultPath: this.localDestination.path ?? undefined,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null
    const folder = picked.filePaths[0]
    await this.store.updateSettings({ destinationFolder: folder })
    await this.refreshLocalDestination()
    this.broadcastSettings()
    return folder
  }

  async openPath(target: string): Promise<void> {
    if (!target) return
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
  }

  async revealPath(target: string): Promise<void> {
    if (!target) return
    shell.showItemInFolder(target)
  }

  async openFullDiskAccess(): Promise<void> {
    await shell.openExternal(FULL_DISK_ACCESS_URL)
  }

  async getPeers(): Promise<Peer[]> {
    return this.demo ? demoPeers() : this.peers
  }

  async refreshPeers(): Promise<Peer[]> {
    if (this.demo) return demoPeers()
    const settings = this.store.getSettings()
    if (settings.manualPeerHost && settings.manualPeerPort) {
      await this.resolveManualPeer(settings.manualPeerHost, settings.manualPeerPort).catch(
        () => undefined
      )
    }
    this.peers = this.discovery.getPeers()
    this.reconcileSelection()
    this.sendPeers()
    return this.peers
  }

  async connectManually(host: string, port: number): Promise<Peer | null> {
    if (this.demo) return demoPeers()[0] ?? null
    const peer = await this.resolveManualPeer(host, port).catch(() => null)
    if (!peer) return null
    this.selectedPeerId = peer.instanceId
    await this.store.updateSettings({ manualPeerHost: host, manualPeerPort: port })
    this.sendPeers()
    this.broadcastSettings()
    return peer
  }

  async selectPeer(instanceId: string | null): Promise<void> {
    if (instanceId && !this.peers.some((peer) => peer.instanceId === instanceId)) {
      throw new Error('That device is no longer available.')
    }
    this.selectedPeerId = instanceId
    this.sendPeers()
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const before = this.store.getSettings()
    const settings = await this.store.updateSettings(patch)
    nativeTheme.themeSource = settings.theme

    const sourceChanged = before.sourceFolder !== settings.sourceFolder
    const portChanged = before.port !== settings.port
    const discoveryChanged = before.discoveryEnabled !== settings.discoveryEnabled
    const manualChanged =
      before.manualPeerHost !== settings.manualPeerHost ||
      before.manualPeerPort !== settings.manualPeerPort

    if (sourceChanged) {
      await this.refreshSource()
    }
    if (before.destinationFolder !== settings.destinationFolder) {
      await this.refreshLocalDestination()
    }
    if ((portChanged || discoveryChanged) && !this.demo) {
      await this.restartNetwork(settings)
      if (discoveryChanged && !settings.discoveryEnabled) {
        this.discovery.clearDiscoveredPeers()
        this.peers = this.discovery.getPeers()
        this.reconcileSelection()
      }
    }
    if (manualChanged && !this.demo) {
      if (settings.manualPeerHost && settings.manualPeerPort) {
        await this.resolveManualPeer(settings.manualPeerHost, settings.manualPeerPort).catch(
          () => undefined
        )
      } else {
        this.discovery.removeManualPeers()
        this.peers = this.discovery.getPeers()
        this.reconcileSelection()
      }
    }
    this.broadcastSettings()
    this.sendPeers()
    return settings
  }

  async startTransfer(request: TransferRequest): Promise<TransferStartResult> {
    if (this.demo) {
      return { ok: false, error: 'Demo mode is for previewing the interface only.' }
    }
    if (this.activeTransfer) {
      return { ok: false, error: 'A transfer is already in progress.' }
    }
    const settings = this.store.getSettings()
    const peer = this.peers.find((item) => item.instanceId === request.peerInstanceId)
    if (!peer) return { ok: false, error: 'Choose a destination PC first.' }
    const selected = this.saves.filter((save) => request.saveIds.includes(save.id))
    if (selected.length === 0) return { ok: false, error: 'Select at least one save.' }

    const controller = new AbortController()
    this.activeTransfer = controller
    try {
      const outcome = await sendSaves({
        peer,
        saves: selected,
        backup: request.backup,
        identity: {
          instanceId: this.instanceId,
          name: settings.deviceName,
          platform: currentPlatform()
        },
        signal: controller.signal,
        onProgress: (progress: TransferProgress) => this.send('transfer:progress', progress),
        log: (message) => this.log(message)
      })
      const history = this.store.addHistory(outcome.record)
      this.send('history:changed', history)
      return {
        ok: outcome.ok,
        error: outcome.ok ? undefined : outcome.record.error ?? 'Transfer failed.',
        transferId: outcome.record.id
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    } finally {
      this.activeTransfer = null
    }
  }

  async cancelTransfer(): Promise<void> {
    this.activeTransfer?.abort()
  }

  async respondIncoming(requestId: string, response: IncomingResponse): Promise<void> {
    const pending = this.incoming.get(requestId)
    if (!pending) return
    this.incoming.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(response)
  }

  async clearHistory(): Promise<TransferRecord[]> {
    const records = await this.store.clearHistory()
    this.send('history:changed', records)
    return records
  }

  private async promptIncoming(request: IncomingRequest): Promise<IncomingResponse> {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return { accept: false, backup: false }
    return new Promise<IncomingResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.incoming.delete(request.requestId)
        resolve({ accept: false, backup: request.backupRequested })
      }, 120_000)
      this.incoming.set(request.requestId, { resolve, timer })
      this.send('transfer:incoming', request)
    })
  }

  private async resolveManualPeer(host: string, port: number): Promise<Peer | null> {
    const cleanHost = host.trim()
    const probe = await rustProbePeer(cleanHost, port, 3000)
    const info =
      probe?.reachable && probe.info && typeof probe.info === 'object'
        ? probe.info
        : await httpGetJson(cleanHost, port)
    if (info.app !== 'inzoi-save-bridge') {
      throw new Error('That address is not running inZOI Save Bridge.')
    }
    if (typeof info.instanceId !== 'string' || info.instanceId === this.instanceId) {
      throw new Error('That address is this device.')
    }
    const remotePort = Number(info.port)
    if (!Number.isInteger(remotePort) || remotePort <= 0) {
      throw new Error('That device did not report a transfer port.')
    }
    const rttMs = typeof probe?.rttMs === 'number' ? Math.round(probe.rttMs * 10) / 10 : null
    if (rttMs !== null) {
      this.peerRtt.set(info.instanceId, rttMs)
    }
    const peer: Peer = {
      instanceId: info.instanceId,
      name: typeof info.name === 'string' ? info.name : cleanHost,
      platform: typeof info.platform === 'string' ? info.platform : 'unknown',
      osVersion: typeof info.osVersion === 'string' ? info.osVersion : null,
      host: cleanHost,
      port: remotePort,
      savesPath: typeof info.savesPath === 'string' ? info.savesPath : null,
      version: typeof info.version === 'string' ? info.version : '',
      accepting: Boolean(info.accepting),
      manual: true,
      lastSeen: Date.now(),
      rttMs
    }
    this.discovery.upsertManualPeer(peer)
    this.peers = this.discovery.getPeers().map((p) => ({
      ...p,
      rttMs: this.peerRtt.get(p.instanceId) ?? p.rttMs ?? null
    }))
    return peer
  }

  private async probeDiscoveredPeers(): Promise<void> {
    if (this.probingPeers || this.demo) return
    this.probingPeers = true
    try {
      let updated = false
      for (const peer of [...this.peers]) {
        if (!peer.host || !peer.port) continue
        const probe = await rustProbePeer(peer.host, peer.port, 1800)
        if (probe?.reachable && typeof probe.rttMs === 'number') {
          const rtt = Math.round(probe.rttMs * 10) / 10
          if (this.peerRtt.get(peer.instanceId) !== rtt) {
            this.peerRtt.set(peer.instanceId, rtt)
            updated = true
          }
        }
      }
      if (updated) {
        this.peers = this.peers.map((p) => ({
          ...p,
          rttMs: this.peerRtt.get(p.instanceId) ?? p.rttMs ?? null
        }))
        this.sendPeers()
      }
    } finally {
      this.probingPeers = false
    }
  }

  private async startNetwork(settings: AppSettings): Promise<void> {
    if (this.networkStarted) return
    this.networkStarted = true
    try {
      await this.server.start(settings.port)
    } catch (error) {
      this.log(`Could not start receiver: ${(error as Error).message}`)
    }
    if (settings.discoveryEnabled) this.discovery.start()
  }

  private async restartNetwork(settings: AppSettings): Promise<void> {
    this.discovery.stop()
    this.server.stop()
    this.networkStarted = false
    await this.startNetwork(settings)
  }

  private async refreshSource(): Promise<ScanResult> {
    const settings = this.store.getSettings()
    const resolved = await resolveSource(settings)
    this.source = resolved.state
    if (this.source.readable && this.source.path) {
      const scan = await scanSaveEntriesWithMetrics(this.source.path)
      this.saves = scan.saves
      this.engine = scan.engine
      this.scanDurationMs = scan.durationMs
    } else {
      this.saves = []
    }
    const result: ScanResult = {
      folder: this.source,
      saves: this.demo ? demoSaves(this.source) : this.saves,
      engine: this.engine,
      scanDurationMs: this.scanDurationMs
    }
    this.send('source:changed', result)
    return result
  }

  private async scanFolder(
    folder: string,
    label: string,
    kind: SaveFolderState['kind']
  ): Promise<ScanResult> {
    this.source = await folderStateForPath(folder, label, kind)
    if (this.source.readable && this.source.path) {
      const scan = await scanSaveEntriesWithMetrics(this.source.path)
      this.saves = scan.saves
      this.engine = scan.engine
      this.scanDurationMs = scan.durationMs
    } else {
      this.saves = []
    }
    const result: ScanResult = {
      folder: this.source,
      saves: this.saves,
      engine: this.engine,
      scanDurationMs: this.scanDurationMs
    }
    this.send('source:changed', result)
    return result
  }

  private async refreshLocalDestination(): Promise<void> {
    const resolved = await resolveLocalDestination(this.store.getSettings())
    this.localDestination = {
      path: resolved.path,
      exists: resolved.exists,
      readable: resolved.readable
    }
  }

  private reconcileSelection(): void {
    if (this.selectedPeerId && this.peers.some((peer) => peer.instanceId === this.selectedPeerId)) {
      return
    }
    const preferred =
      this.peers.find((peer) => peer.platform === 'win32' && peer.accepting) ??
      this.peers.find((peer) => peer.accepting) ??
      this.peers[0] ??
      null
    this.selectedPeerId = preferred?.instanceId ?? null
  }

  private sendPeers(): void {
    this.send('peers:changed', this.peers, this.selectedPeerId)
  }

  private broadcastSettings(): void {
    this.send('settings:changed', this.store.getSettings())
  }

  private send(channel: string, ...args: unknown[]): void {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(channel, ...args)
  }

  private log(message: string): void {
    console.log(`[${APP_NAME}] ${message}`)
  }
}
