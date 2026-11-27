import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Folder,
  Loader2,
  X
} from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { formatBytes, pluralize } from '../lib/format'

export function TransferOverlay(): JSX.Element | null {
  const {
    activeTransfer,
    cancelTransfer,
    dismissTransfer,
    setPage,
    selectedPeer
  } = useBridge()

  if (!activeTransfer) return null
  const progress = activeTransfer
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.transferredBytes / progress.totalBytes) * 100))
      : 0
  const isDone = progress.status === 'completed'
  const isFailed = progress.status === 'failed'
  const isCancelled = progress.status === 'cancelled'
  const isTerminal = isDone || isFailed || isCancelled
  const incoming = progress.direction === 'incoming'

  const title = isDone
    ? incoming
      ? 'Saves received'
      : 'Saves delivered'
    : isFailed
      ? 'Transfer stopped'
      : isCancelled
        ? 'Transfer cancelled'
        : incoming
          ? `Receiving from ${progress.peerName}`
          : progress.status === 'waiting'
            ? `Waiting for ${progress.peerName}`
            : progress.status === 'finalizing'
              ? 'Finishing up'
              : progress.status === 'preparing'
                ? 'Packing your saves'
                : `Sending to ${progress.peerName}`

  const detail = isDone
    ? incoming
      ? `${progress.saveNames.length} ${pluralize(progress.saveNames.length, 'save')} landed in your inZOI folder.`
      : `${formatBytes(progress.totalBytes)} is now on ${progress.peerName}.`
    : isFailed
      ? progress.error ?? 'The other PC stopped responding.'
      : isCancelled
        ? 'Nothing was changed on the destination. Your originals are untouched.'
        : progress.status === 'waiting'
          ? 'Accept the transfer on the other device to keep going.'
          : incoming
            ? `${formatBytes(progress.transferredBytes)} of ${formatBytes(progress.totalBytes)}`
            : `${progress.filesDone} of ${progress.fileCount} files · ${formatBytes(progress.transferredBytes)} of ${formatBytes(progress.totalBytes)}`

  return (
    <div className={`transfer-popover ${isDone ? 'is-done' : ''} ${isFailed ? 'is-error' : ''}`} aria-live="polite">
      <div className="transfer-popover-head">
        <span className={`transfer-popover-icon ${isDone ? 'is-done' : isFailed ? 'is-error' : ''}`}>
          {isDone ? (
            <Check size={20} strokeWidth={3} />
          ) : isFailed ? (
            <AlertCircle size={20} />
          ) : incoming ? (
            <ArrowDownToLine size={20} />
          ) : (
            <ArrowUpFromLine size={20} />
          )}
        </span>
        <div className="transfer-popover-copy">
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
        {isTerminal && (
          <button type="button" className="overlay-close" aria-label="Dismiss" onClick={dismissTransfer}>
            <X size={17} />
          </button>
        )}
      </div>

      {!isTerminal && (
        <>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {percent}%
              {progress.speedBytesPerSec && progress.speedBytesPerSec > 0
                ? ` · ${formatBytes(progress.speedBytesPerSec)}/s`
                : ''}
            </span>
            <span>{progress.currentFile ?? 'Preparing files…'}</span>
          </div>
        </>
      )}

      {isDone && (
        <div className="transfer-result-row">
          <span>
            <Folder size={15} /> {progress.destinationPath ?? 'inZOI SaveGames'}
          </span>
          <strong>{formatBytes(progress.totalBytes)}</strong>
        </div>
      )}

      <div className="transfer-popover-actions">
        {!isTerminal ? (
          <>
            <span className="transfer-live">
              <Loader2 size={14} className="spin" />
              {progress.direction === 'outgoing' ? 'On your local network' : 'Writing safely'}
            </span>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => void cancelTransfer()}
              disabled={incoming}
            >
              {incoming ? 'Please wait' : 'Cancel'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button button-ghost button-small" onClick={dismissTransfer}>
              Dismiss
            </button>
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => {
                setPage('history')
                dismissTransfer()
              }}
            >
              View history
            </button>
          </>
        )}
      </div>
      {selectedPeer && !isTerminal && progress.direction === 'outgoing' && (
        <p className="transfer-destination-note" title={selectedPeer.savesPath ?? undefined}>
          Destination: {selectedPeer.savesPath ?? selectedPeer.name}
        </p>
      )}
    </div>
  )
}
