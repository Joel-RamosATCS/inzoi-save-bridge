import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, IncomingRequest, IncomingResponse, Peer, SaveBridgeApi, ScanResult, TransferProgress, TransferRecord } from '@shared/types'

function subscribe<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
    callback(...(args as T))
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SaveBridgeApi = {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  refresh: () => ipcRenderer.invoke('app:refresh'),
  scanSaves: () => ipcRenderer.invoke('saves:scan'),
  chooseSourceFolder: () => ipcRenderer.invoke('source:choose'),
  useSourceCandidate: (candidateId: string) =>
    ipcRenderer.invoke('source:use-candidate', candidateId),
  setSourceFolder: (folder: string) => ipcRenderer.invoke('source:set', folder),
  resetSourceFolder: () => ipcRenderer.invoke('source:reset'),
  chooseDestinationFolder: () => ipcRenderer.invoke('destination:choose'),
  openPath: (target: string) => ipcRenderer.invoke('shell:open', target),
  revealPath: (target: string) => ipcRenderer.invoke('shell:reveal', target),
  openFullDiskAccess: () => ipcRenderer.invoke('shell:full-disk-access'),
  getPeers: () => ipcRenderer.invoke('peers:get'),
  refreshPeers: () => ipcRenderer.invoke('peers:refresh'),
  connectManually: (host: string, port: number) =>
    ipcRenderer.invoke('peers:connect', host, port),
  selectPeer: (instanceId: string | null) =>
    ipcRenderer.invoke('peers:select', instanceId),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', patch),
  startTransfer: (request) => ipcRenderer.invoke('transfer:start', request),
  cancelTransfer: () => ipcRenderer.invoke('transfer:cancel'),
  respondIncoming: (requestId: string, response: IncomingResponse) =>
    ipcRenderer.invoke('incoming:respond', requestId, response),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  onPeers: (callback: (peers: Peer[], selectedPeerId: string | null) => void) =>
    subscribe('peers:changed', callback),
  onScanned: (callback: (result: ScanResult) => void) =>
    subscribe('source:changed', callback),
  onSource: (callback: (result: ScanResult) => void) =>
    subscribe('source:changed', callback),
  onProgress: (callback: (progress: TransferProgress) => void) =>
    subscribe('transfer:progress', callback),
  onIncoming: (callback: (request: IncomingRequest) => void) =>
    subscribe('transfer:incoming', callback),
  onHistory: (callback: (records: TransferRecord[]) => void) =>
    subscribe('history:changed', callback),
  onSettings: (callback: (settings: AppSettings) => void) =>
    subscribe('settings:changed', callback)
}

contextBridge.exposeInMainWorld('saveBridge', api)
