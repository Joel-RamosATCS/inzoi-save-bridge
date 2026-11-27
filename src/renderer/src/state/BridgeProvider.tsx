import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AppPlatform,
  AppSettings,
  Bootstrap,
  EngineKind,
  IncomingRequest,
  LocalDestination,
  Peer,
  SaveEntry,
  SaveFolderState,
  ScanResult,
  TransferProgress,
  TransferRecord
} from '@shared/types'

export type Page = 'transfer' | 'history' | 'settings'
export type ModalName = 'source' | 'destination' | 'help' | null
export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  tone: ToastTone
  title: string
  message?: string
}

interface BridgeContextValue {
  ready: boolean
  loadError: string | null
  refreshing: boolean
  platform: AppPlatform
  appVersion: string
  demo: boolean
  settings: AppSettings
  source: SaveFolderState
  saves: SaveEntry[]
  peers: Peer[]
  selectedPeerId: string | null
  selectedPeer: Peer | null
  localDestination: LocalDestination
  history: TransferRecord[]
  dataDir: string
  receiverPort: number
  localAddresses: string[]
  engine: EngineKind
  scanDurationMs: number
  selection: Set<string>
  selectedSaves: SaveEntry[]
  selectedBytes: number
  page: Page
  modal: ModalName
  activeTransfer: TransferProgress | null
  incoming: IncomingRequest | null
  toasts: Toast[]
  setPage: (page: Page) => void
  openModal: (modal: ModalName) => void
  closeModal: () => void
  refreshAll: () => Promise<void>
  chooseSource: () => Promise<void>
  useSourceCandidate: (id: string) => Promise<void>
  resetSource: () => Promise<void>
  chooseDestination: () => Promise<void>
  toggleSave: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  selectPeer: (id: string | null) => Promise<void>
  connectManually: (host: string, port: number) => Promise<Peer | null>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  startTransfer: () => Promise<void>
  cancelTransfer: () => Promise<void>
  dismissTransfer: () => void
  respondIncoming: (request: IncomingRequest, accept: boolean, backup: boolean) => Promise<void>
  clearHistory: () => Promise<void>
  notify: (tone: ToastTone, title: string, message?: string) => void
  dismissToast: (id: string) => void
  openPath: (path: string) => Promise<void>
  revealPath: (path: string) => Promise<void>
  openFullDiskAccess: () => Promise<void>
}

const fallbackSettings: AppSettings = {
  deviceName: 'My Mac',
  sourceFolder: null,
  destinationFolder: null,
  backupBeforeReplacing: true,
  askBeforeAccepting: true,
  theme: 'system',
  glassPreset: 'amethyst',
  glassIntensity: 'ultra',
  specularRim: true,
  ambientMotion: true,
  port: 47772,
  discoveryEnabled: true,
  manualPeerHost: null,
  manualPeerPort: null
}

const emptySource: SaveFolderState = {
  path: null,
  exists: false,
  readable: false,
  permissionDenied: false,
  kind: 'unknown',
  label: 'No save folder',
  platform: 'unknown',
  candidates: [],
  error: null
}

const BridgeContext = createContext<BridgeContextValue | null>(null)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function BridgeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [platform, setPlatform] = useState<AppPlatform>('unknown')
  const [appVersion, setAppVersion] = useState('')
  const [demo, setDemo] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings)
  const [source, setSource] = useState<SaveFolderState>(emptySource)
  const [saves, setSaves] = useState<SaveEntry[]>([])
  const [peers, setPeers] = useState<Peer[]>([])
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null)
  const [localDestination, setLocalDestination] = useState<LocalDestination>({
    path: null,
    exists: false,
    readable: false
  })
  const [history, setHistory] = useState<TransferRecord[]>([])
  const [dataDir, setDataDir] = useState('')
  const [receiverPort, setReceiverPort] = useState(0)
  const [localAddresses, setLocalAddresses] = useState<string[]>([])
  const [engine, setEngine] = useState<EngineKind>('rust-native')
  const [scanDurationMs, setScanDurationMs] = useState(0.8)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [page, setPage] = useState<Page>('transfer')
  const [modal, setModal] = useState<ModalName>(null)
  const [activeTransfer, setActiveTransfer] = useState<TransferProgress | null>(null)
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const selectionPathRef = useRef<string | null | undefined>(undefined)
  const incomingRefreshRef = useRef(false)

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (tone: ToastTone, title: string, message?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setToasts((current) => [...current.slice(-2), { id, tone, title, message }])
      setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4500)
    },
    [dismissToast]
  )

  const initializeSelection = useCallback(
    (path: string | null, nextSaves: SaveEntry[], force = false) => {
      const pathChanged = selectionPathRef.current !== path
      selectionPathRef.current = path
      if (force || pathChanged) {
        setSelection(new Set(nextSaves[0] ? [nextSaves[0].id] : []))
        return
      }
      setSelection((current) => {
        const next = new Set([...current].filter((id) => nextSaves.some((save) => save.id === id)))
        return next
      })
    },
    []
  )

  const applyBootstrap = useCallback(
    (data: Bootstrap, forceSelection = false) => {
      setPlatform(data.platform)
      setAppVersion(data.appVersion)
      setDemo(data.demo)
      setSettings(data.settings)
      setSource(data.source)
      setSaves(data.saves)
      setPeers(data.peers)
      setSelectedPeerId(data.selectedPeerId)
      setLocalDestination(data.localDestination)
      setHistory(data.history)
      setDataDir(data.dataDir)
      setReceiverPort(data.receiverPort)
      setLocalAddresses(data.localAddresses)
      if (data.engine) setEngine(data.engine)
      if (typeof data.scanDurationMs === 'number') setScanDurationMs(data.scanDurationMs)
      initializeSelection(data.source.path, data.saves, forceSelection)
      setReady(true)
    },
    [initializeSelection]
  )

  const applyScan = useCallback(
    (result: ScanResult) => {
      setSource(result.folder)
      setSaves(result.saves)
      if (result.engine) setEngine(result.engine)
      if (typeof result.scanDurationMs === 'number') setScanDurationMs(result.scanDurationMs)
      initializeSelection(result.folder.path, result.saves)
      if (result.folder.permissionDenied) {
        notify(
          'error',
          'macOS is protecting that folder',
          'Grant Full Disk Access to inZOI Save Bridge, then refresh.'
        )
      }
    },
    [initializeSelection, notify]
  )

  useEffect(() => {
    let mounted = true
    window.saveBridge
      .getBootstrap()
      .then((data) => {
        if (mounted) applyBootstrap(data, true)
      })
      .catch((error) => {
        if (!mounted) return
        setLoadError(messageOf(error))
        setReady(true)
      })
    return () => {
      mounted = false
    }
  }, [applyBootstrap])

  useEffect(() => {
    const unsubscribeScan = window.saveBridge.onScanned((result) => applyScan(result))
    const unsubscribePeers = window.saveBridge.onPeers((nextPeers, nextSelection) => {
      setPeers(nextPeers)
      setSelectedPeerId(nextSelection)
    })
    const unsubscribeSettings = window.saveBridge.onSettings((nextSettings) => {
      setSettings(nextSettings)
    })
    const unsubscribeHistory = window.saveBridge.onHistory((records) => {
      setHistory(records)
    })
    const unsubscribeProgress = window.saveBridge.onProgress((progress) => {
      setActiveTransfer(progress)
      if (
        progress.direction === 'incoming' &&
        progress.status === 'completed' &&
        !incomingRefreshRef.current
      ) {
        incomingRefreshRef.current = true
        window.setTimeout(() => {
          incomingRefreshRef.current = false
          window.saveBridge
            .scanSaves()
            .then((result) => applyScan(result))
            .catch(() => undefined)
        }, 700)
      }
    })
    const unsubscribeIncoming = window.saveBridge.onIncoming((request) => {
      setIncoming(request)
    })
    return () => {
      unsubscribeScan()
      unsubscribePeers()
      unsubscribeSettings()
      unsubscribeHistory()
      unsubscribeProgress()
      unsubscribeIncoming()
    }
  }, [applyScan])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      const root = document.documentElement
      root.dataset.theme = theme
      root.dataset.glassPreset = settings.glassPreset ?? 'amethyst'
      root.dataset.glassIntensity = settings.glassIntensity ?? 'ultra'
      root.dataset.specularRim = (settings.specularRim ?? true) ? 'on' : 'off'
      root.dataset.ambientMotion = (settings.ambientMotion ?? true) ? 'on' : 'off'
      root.style.colorScheme = theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [
    settings.theme,
    settings.glassPreset,
    settings.glassIntensity,
    settings.specularRim,
    settings.ambientMotion
  ])

  const refreshAll = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const data = await window.saveBridge.refresh()
      applyBootstrap(data)
    } catch (error) {
      notify('error', 'Could not refresh', messageOf(error))
    } finally {
      setRefreshing(false)
    }
  }, [applyBootstrap, notify, refreshing])

  const chooseSource = useCallback(async () => {
    try {
      const result = await window.saveBridge.chooseSourceFolder()
      if (result) {
        applyScan(result)
        setModal(null)
        notify('success', 'Save folder updated', result.folder.path ?? undefined)
      }
    } catch (error) {
      notify('error', 'Could not use that folder', messageOf(error))
    }
  }, [applyScan, notify])

  const useSourceCandidate = useCallback(
    async (id: string) => {
      try {
        const result = await window.saveBridge.useSourceCandidate(id)
        applyScan(result)
        setModal(null)
      } catch (error) {
        notify('error', 'Could not switch folders', messageOf(error))
      }
    },
    [applyScan, notify]
  )

  const resetSource = useCallback(async () => {
    try {
      const result = await window.saveBridge.resetSourceFolder()
      applyScan(result)
      notify('info', 'Automatic detection restored')
    } catch (error) {
      notify('error', 'Could not reset', messageOf(error))
    }
  }, [applyScan, notify])

  const chooseDestination = useCallback(async () => {
    try {
      const folder = await window.saveBridge.chooseDestinationFolder()
      if (!folder) return
      const data = await window.saveBridge.refresh()
      applyBootstrap(data)
      notify('success', 'Incoming folder updated', folder)
    } catch (error) {
      notify('error', 'Could not update folder', messageOf(error))
    }
  }, [applyBootstrap, notify])

  const toggleSave = useCallback((id: string) => {
    setSelection((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelection(new Set(saves.map((save) => save.id)))
  }, [saves])

  const clearSelection = useCallback(() => {
    setSelection(new Set())
  }, [])

  const selectPeer = useCallback(
    async (id: string | null) => {
      try {
        await window.saveBridge.selectPeer(id)
        setSelectedPeerId(id)
      } catch (error) {
        notify('error', 'Could not select that PC', messageOf(error))
      }
    },
    [notify]
  )

  const connectManually = useCallback(
    async (host: string, port: number) => {
      try {
        const peer = await window.saveBridge.connectManually(host, port)
        if (peer) {
          const data = await window.saveBridge.refresh()
          applyBootstrap(data)
          notify('success', `Connected to ${peer.name}`, `${host}:${port}`)
        } else {
          notify('error', 'Could not connect', 'Check the address and make sure Save Bridge is open.')
        }
        return peer
      } catch (error) {
        notify('error', 'Could not connect', messageOf(error))
        return null
      }
    },
    [applyBootstrap, notify]
  )

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const previous = settings
      setSettings((current) => ({ ...current, ...patch }))
      try {
        const next = await window.saveBridge.updateSettings(patch)
        setSettings(next)
      } catch (error) {
        setSettings(previous)
        notify('error', 'Could not save setting', messageOf(error))
      }
    },
    [notify, settings]
  )

  const startTransfer = useCallback(async () => {
    if (demo) {
      notify('info', 'Demo mode', 'This preview uses sample saves. Run the app normally to transfer.')
      return
    }
    const peer = peers.find((item) => item.instanceId === selectedPeerId)
    if (!peer) {
      setModal('destination')
      return
    }
    const ids = saves.filter((save) => selection.has(save.id)).map((save) => save.id)
    if (ids.length === 0) {
      notify('info', 'Pick a save first')
      return
    }
    try {
      const result = await window.saveBridge.startTransfer({
        saveIds: ids,
        peerInstanceId: peer.instanceId,
        backup: settings.backupBeforeReplacing
      })
      if (!result.ok && result.error && !/cancelled/i.test(result.error)) {
        notify('error', 'Transfer did not finish', result.error)
      }
    } catch (error) {
      notify('error', 'Transfer did not finish', messageOf(error))
    }
  }, [demo, notify, peers, saves, selectedPeerId, selection, settings.backupBeforeReplacing])

  const cancelTransfer = useCallback(async () => {
    await window.saveBridge.cancelTransfer().catch(() => undefined)
  }, [])

  const dismissTransfer = useCallback(() => {
    setActiveTransfer(null)
  }, [])

  const respondIncoming = useCallback(
    async (request: IncomingRequest, accept: boolean, backup: boolean) => {
      setIncoming(null)
      try {
        await window.saveBridge.respondIncoming(request.requestId, { accept, backup })
        if (!accept) notify('info', 'Transfer declined')
      } catch (error) {
        notify('error', 'Could not answer the transfer', messageOf(error))
      }
    },
    [notify]
  )

  const clearHistory = useCallback(async () => {
    if (demo) {
      setHistory([])
      return
    }
    try {
      const records = await window.saveBridge.clearHistory()
      setHistory(records)
      notify('info', 'Transfer history cleared')
    } catch (error) {
      notify('error', 'Could not clear history', messageOf(error))
    }
  }, [demo, notify])

  const openPath = useCallback(
    async (path: string) => {
      try {
        await window.saveBridge.openPath(path)
      } catch (error) {
        notify('error', 'Could not open that folder', messageOf(error))
      }
    },
    [notify]
  )

  const revealPath = useCallback(
    async (path: string) => {
      try {
        await window.saveBridge.revealPath(path)
      } catch (error) {
        notify('error', 'Could not reveal that folder', messageOf(error))
      }
    },
    [notify]
  )

  const openFullDiskAccess = useCallback(async () => {
    await window.saveBridge.openFullDiskAccess().catch(() => undefined)
  }, [])

  const selectedPeer = useMemo(
    () => peers.find((peer) => peer.instanceId === selectedPeerId) ?? null,
    [peers, selectedPeerId]
  )

  const selectedSaves = useMemo(
    () => saves.filter((save) => selection.has(save.id)),
    [saves, selection]
  )

  const selectedBytes = useMemo(
    () => selectedSaves.reduce((sum, save) => sum + save.sizeBytes, 0),
    [selectedSaves]
  )

  const value: BridgeContextValue = {
    ready,
    loadError,
    refreshing,
    platform,
    appVersion,
    demo,
    settings,
    source,
    saves,
    peers,
    selectedPeerId,
    selectedPeer,
    localDestination,
    history,
    dataDir,
    receiverPort,
    localAddresses,
    engine,
    scanDurationMs,
    selection,
    selectedSaves,
    selectedBytes,
    page,
    modal,
    activeTransfer,
    incoming,
    toasts,
    setPage,
    openModal: setModal,
    closeModal: () => setModal(null),
    refreshAll,
    chooseSource,
    useSourceCandidate,
    resetSource,
    chooseDestination,
    toggleSave,
    selectAll,
    clearSelection,
    selectPeer,
    connectManually,
    updateSettings,
    startTransfer,
    cancelTransfer,
    dismissTransfer,
    respondIncoming,
    clearHistory,
    notify,
    dismissToast,
    openPath,
    revealPath,
    openFullDiskAccess
  }

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>
}

export function useBridge(): BridgeContextValue {
  const context = useContext(BridgeContext)
  if (!context) throw new Error('useBridge must be used inside BridgeProvider')
  return context
}
