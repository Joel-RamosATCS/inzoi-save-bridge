export type AppPlatform = 'darwin' | 'win32' | 'linux' | string

export type SaveAccent = 'lavender' | 'butter' | 'blush'

export type SaveKind = 'app-store' | 'steam' | 'custom' | 'unknown'

export type ThemeMode = 'light' | 'dark' | 'system'

export type GlassPreset = 'amethyst' | 'emerald' | 'aurora' | 'obsidian'

export type GlassIntensity = 'subtle' | 'balanced' | 'ultra'

export type EngineKind = 'rust-native' | 'node-fallback'

export interface SaveEntry {
  id: string
  folderName: string
  path: string
  title: string
  world: string
  characterName: string | null
  modifiedAt: number
  sizeBytes: number
  fileCount: number
  gameVersion: string | null
  saveType: string | null
  accent: SaveAccent
  metadataFound: boolean
  fingerprint?: string
}

export interface SaveFolderCandidate {
  id: string
  label: string
  path: string
  kind: SaveKind
  exists: boolean
  readable: boolean
}

export interface SaveFolderState {
  path: string | null
  exists: boolean
  readable: boolean
  permissionDenied: boolean
  kind: SaveKind
  label: string
  platform: AppPlatform
  candidates: SaveFolderCandidate[]
  error: string | null
}

export interface ScanResult {
  folder: SaveFolderState
  saves: SaveEntry[]
  engine?: EngineKind
  scanDurationMs?: number
}

export interface AppSettings {
  deviceName: string
  sourceFolder: string | null
  destinationFolder: string | null
  backupBeforeReplacing: boolean
  askBeforeAccepting: boolean
  theme: ThemeMode
  glassPreset?: GlassPreset
  glassIntensity?: GlassIntensity
  specularRim?: boolean
  ambientMotion?: boolean
  port: number
  discoveryEnabled: boolean
  manualPeerHost: string | null
  manualPeerPort: number | null
}

export interface Peer {
  instanceId: string
  name: string
  platform: AppPlatform
  osVersion: string | null
  host: string
  port: number
  savesPath: string | null
  version: string
  accepting: boolean
  manual: boolean
  lastSeen: number
  rttMs?: number | null
}

export interface LocalDestination {
  path: string | null
  exists: boolean
  readable: boolean
}

export type TransferDirection = 'outgoing' | 'incoming'

export type TransferStatus =
  | 'preparing'
  | 'waiting'
  | 'transferring'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TransferProgress {
  transferId: string
  direction: TransferDirection
  peerName: string
  peerPlatform: AppPlatform
  saveNames: string[]
  totalBytes: number
  transferredBytes: number
  fileCount: number
  filesDone: number
  currentFile: string | null
  status: TransferStatus
  destinationPath: string | null
  error: string | null
  speedBytesPerSec?: number
}

export type HistoryStatus = 'completed' | 'failed' | 'cancelled'

export interface TransferRecord {
  id: string
  at: number
  direction: TransferDirection
  peerName: string
  peerPlatform: AppPlatform
  saveNames: string[]
  totalBytes: number
  fileCount: number
  folderPath: string
  status: HistoryStatus
  error: string | null
}

export interface IncomingRequest {
  requestId: string
  peerName: string
  peerPlatform: AppPlatform
  saveNames: string[]
  totalBytes: number
  fileCount: number
  destinationPath: string | null
  backupRequested: boolean
}

export interface Bootstrap {
  platform: AppPlatform
  appVersion: string
  settings: AppSettings
  source: SaveFolderState
  saves: SaveEntry[]
  peers: Peer[]
  selectedPeerId: string | null
  localDestination: LocalDestination
  history: TransferRecord[]
  dataDir: string
  receiverPort: number
  localAddresses: string[]
  demo: boolean
  engine?: EngineKind
  scanDurationMs?: number
}

export interface TransferRequest {
  saveIds: string[]
  peerInstanceId: string
  backup: boolean
}

export interface TransferStartResult {
  ok: boolean
  error?: string
  transferId?: string
}

export interface IncomingResponse {
  accept: boolean
  backup: boolean
}

export interface SaveBridgeApi {
  getBootstrap(): Promise<Bootstrap>
  refresh(): Promise<Bootstrap>
  scanSaves(): Promise<ScanResult>
  chooseSourceFolder(): Promise<ScanResult | null>
  useSourceCandidate(candidateId: string): Promise<ScanResult>
  setSourceFolder(path: string): Promise<ScanResult>
  resetSourceFolder(): Promise<ScanResult>
  chooseDestinationFolder(): Promise<string | null>
  openPath(path: string): Promise<void>
  revealPath(path: string): Promise<void>
  openFullDiskAccess(): Promise<void>
  getPeers(): Promise<Peer[]>
  refreshPeers(): Promise<Peer[]>
  connectManually(host: string, port: number): Promise<Peer | null>
  selectPeer(instanceId: string | null): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  startTransfer(request: TransferRequest): Promise<TransferStartResult>
  cancelTransfer(): Promise<void>
  respondIncoming(requestId: string, response: IncomingResponse): Promise<void>
  clearHistory(): Promise<TransferRecord[]>
  copyText(text: string): Promise<void>
  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  onPeers(callback: (peers: Peer[], selectedPeerId: string | null) => void): () => void
  onScanned(callback: (result: ScanResult) => void): () => void
  onProgress(callback: (progress: TransferProgress) => void): () => void
  onIncoming(callback: (request: IncomingRequest) => void): () => void
  onHistory(callback: (records: TransferRecord[]) => void): () => void
  onSettings(callback: (settings: AppSettings) => void): () => void
  onSource(callback: (result: ScanResult) => void): () => void
}
