import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { deviceKindLabel, formatBytes, pluralize } from '../lib/format'

export function TransferFooter(): JSX.Element {
  const {
    selectedSaves,
    selectedBytes,
    selectedPeer,
    activeTransfer,
    startTransfer,
    openModal
  } = useBridge()

  const count = selectedSaves.length
  const transferLabel = selectedPeer
    ? `Transfer to ${deviceKindLabel(selectedPeer.platform).replace('Windows PC', 'Windows')}`
    : 'Choose a destination'
  const busy = Boolean(
    activeTransfer && !['completed', 'failed', 'cancelled'].includes(activeTransfer.status)
  )
  const blocked = !selectedPeer?.accepting
  const disabled = busy || (Boolean(selectedPeer) && (blocked || count === 0))

  const handleClick = (): void => {
    if (!selectedPeer) {
      openModal('destination')
      return
    }
    if (disabled) return
    void startTransfer()
  }

  return (
    <footer className="transfer-footer">
      <div className="transfer-warning">
        <AlertCircle size={22} strokeWidth={1.8} aria-hidden="true" />
        <div>
          <h3>Before you transfer</h3>
          <p>Close inZOI on both devices and use the same game version.</p>
          <p className="privacy-note">Private by design. Your saves never leave your local network.</p>
        </div>
      </div>

      <div className="transfer-actions">
        <div className="transfer-summary">
          <strong>
            {count > 0
              ? `${count} ${pluralize(count, 'save')} · ${formatBytes(selectedBytes)}`
              : 'No saves selected'}
          </strong>
          <span>
            {!selectedPeer
              ? 'Connect on the same Wi-Fi'
              : blocked
                ? 'That PC is not accepting transfers'
                : count === 0
                  ? 'Pick at least one save'
                  : busy
                    ? 'Transfer in progress'
                    : 'Ready to transfer'}
          </span>
        </div>
        <button
          type="button"
          className="transfer-cta"
          onClick={handleClick}
          disabled={disabled}
          aria-busy={busy}
        >
          {busy ? <Loader2 size={22} className="spin" aria-hidden="true" /> : null}
          <span>
            {busy && activeTransfer
              ? `${Math.min(99, Math.round((activeTransfer.transferredBytes / Math.max(1, activeTransfer.totalBytes)) * 100))}% sent`
              : transferLabel}
          </span>
          {!busy && <ArrowRight size={24} strokeWidth={2.2} aria-hidden="true" />}
        </button>
      </div>
    </footer>
  )
}
