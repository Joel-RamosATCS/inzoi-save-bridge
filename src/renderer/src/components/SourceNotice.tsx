import { AlertCircle, FolderOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'

export function SourceNotice(): JSX.Element | null {
  const {
    source,
    platform,
    refreshing,
    refreshAll,
    openModal,
    openFullDiskAccess,
    openPath,
    notify
  } = useBridge()

  if (!source.permissionDenied && source.readable) return null

  const handleOpen = async (): Promise<void> => {
    if (!source.path) return
    try {
      await openPath(source.path)
    } catch (error) {
      notify('error', 'Could not open folder', (error as Error).message)
    }
  }

  return (
    <section className={`source-notice ${source.permissionDenied ? 'is-blocked' : ''}`}>
      <div className="source-notice-icon">
        {source.permissionDenied ? <ShieldCheck size={23} /> : <AlertCircle size={23} />}
      </div>
      <div className="source-notice-copy">
        <h3>
          {source.permissionDenied
            ? platform === 'darwin'
              ? 'macOS is protecting your save folder'
              : 'That save folder needs permission'
            : 'We could not find your inZOI saves'}
        </h3>
        <p>
          {source.permissionDenied
            ? platform === 'darwin'
              ? 'Grant Full Disk Access to inZOI Save Bridge so it can read the App Store container. It only ever copies saves — your originals stay put.'
              : 'Choose the folder again or check its Windows permissions. Save Bridge only ever copies saves — your originals stay put.'
            : platform === 'darwin'
              ? 'Point Save Bridge at your inZOI SaveGames folder. It is usually in Documents or the inZOI App Store container.'
              : 'Point Save Bridge at your inZOI SaveGames folder inside Documents.'}
        </p>
      </div>
      <div className="source-notice-actions">
        {source.permissionDenied ? (
          platform === 'darwin' ? (
            <button type="button" className="button button-primary button-small" onClick={openFullDiskAccess}>
              Open Full Disk Access
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => openModal('source')}
            >
              <FolderOpen size={16} /> Choose folder
            </button>
          )
        ) : (
          <button
            type="button"
            className="button button-primary button-small"
            onClick={() => openModal('source')}
          >
            <FolderOpen size={16} /> Choose folder
          </button>
        )}
        {source.path && (
          <button type="button" className="button button-ghost button-small" onClick={handleOpen}>
            Open folder
          </button>
        )}
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => void refreshAll()}
          disabled={refreshing}
        >
          <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Try again
        </button>
      </div>
    </section>
  )
}
