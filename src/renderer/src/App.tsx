import { useEffect, useRef } from 'react'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { useBridge } from './state/BridgeProvider'
import { TitleBar } from './components/TitleBar'
import { Header } from './components/Header'
import { TransferPage } from './pages/TransferPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { SourceModal } from './components/modals/SourceModal'
import { DestinationModal } from './components/modals/DestinationModal'
import { HelpModal } from './components/modals/HelpModal'
import { IncomingModal } from './components/modals/IncomingModal'
import { TransferOverlay } from './components/TransferOverlay'
import { ToastStack } from './components/ToastStack'

function Splash(): JSX.Element {
  return (
    <div className="splash">
      <div className="splash-drag" aria-hidden="true" />
      <div className="splash-brand">
        <span className="brand-in">in</span>ZOI
        <span className="brand-badge">save bridge</span>
      </div>
      <div className="splash-loader">
        <Loader2 size={20} className="spin" />
        <span>Finding your worlds…</span>
      </div>
    </div>
  )
}

export function App(): JSX.Element {
  const { ready, loadError, page, platform, setPage, refreshAll, modal } = useBridge()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (modal) return
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      if (event.key === '1') {
        event.preventDefault()
        setPage('transfer')
      } else if (event.key === '2') {
        event.preventDefault()
        setPage('history')
      } else if (event.key === '3' || event.key === ',') {
        event.preventDefault()
        setPage('settings')
      } else if (event.key.toLowerCase() === 'r' && !event.shiftKey) {
        event.preventDefault()
        void refreshAll()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modal, refreshAll, setPage])

  if (!ready) return <Splash />

  return (
    <div className="app-shell" data-platform={platform}>
      <div className="ambient-backdrop" aria-hidden="true">
        <span className="ambient-orb orb-violet" />
        <span className="ambient-orb orb-amber" />
        <span className="ambient-orb orb-emerald" />
        <span className="ambient-grid" />
      </div>
      <TitleBar />
      <div className="app-scroll" ref={scrollRef}>
        <div className="shell">
          <Header />
          <main className="app-main">
            {loadError ? (
              <div className="fatal-error">
                <span className="fatal-error-icon">
                  <AlertCircle size={28} />
                </span>
                <h1>Something got in the way.</h1>
                <p>{loadError}</p>
                <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
                  <RefreshCw size={17} /> Try again
                </button>
              </div>
            ) : (
              <div className="page-swap" key={page}>
                {page === 'transfer' ? (
                  <TransferPage />
                ) : page === 'history' ? (
                  <HistoryPage />
                ) : (
                  <SettingsPage />
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      <SourceModal />
      <DestinationModal />
      <HelpModal />
      <IncomingModal />
      <TransferOverlay />
      <ToastStack />
    </div>
  )
}
