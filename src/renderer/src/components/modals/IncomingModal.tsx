import { useEffect, useState } from 'react'
import { ArrowDownToLine, Folder, Monitor, ShieldCheck } from 'lucide-react'
import { useBridge } from '../../state/BridgeProvider'
import { Modal } from '../Modal'
import { formatBytes, pluralize } from '../../lib/format'
import { Toggle } from '../Toggle'

export function IncomingModal(): JSX.Element | null {
  const { incoming, respondIncoming, settings, platform } = useBridge()
  const [backup, setBackup] = useState(settings.backupBeforeReplacing)
  const [answering, setAnswering] = useState(false)

  useEffect(() => {
    if (incoming) setBackup(incoming.backupRequested)
  }, [incoming?.requestId, incoming])

  if (!incoming) return null
  const count = incoming.saveNames.length

  const answer = async (accept: boolean): Promise<void> => {
    setAnswering(true)
    try {
      await respondIncoming(incoming, accept, backup)
    } finally {
      setAnswering(false)
    }
  }

  return (
    <Modal
      title="Saves are arriving"
      eyebrow="Incoming transfer"
      subtitle={`${incoming.peerName} wants to copy ${count} ${pluralize(count, 'save')} to this ${platform === 'darwin' ? 'Mac' : 'PC'}.`}
      icon={<ArrowDownToLine size={24} />}
      tone="butter"
      onClose={() => void answer(false)}
      footer={
        <>
          <div className="incoming-size">
            <strong>{formatBytes(incoming.totalBytes)}</strong>
            <span>
              {count} {pluralize(count, 'save')} · {incoming.fileCount.toLocaleString()} files
            </span>
          </div>
          <div className="modal-footer-spacer" />
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void answer(false)}
            disabled={answering}
          >
            Decline
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void answer(true)}
            disabled={answering}
          >
            Receive {pluralize(count, 'save')} <ArrowDownToLine size={17} />
          </button>
        </>
      }
    >
      <div className="incoming-device">
        <span className="incoming-device-icon">
          <Monitor size={25} strokeWidth={1.8} />
        </span>
        <div>
          <span className="incoming-label">From</span>
          <strong>{incoming.peerName}</strong>
          <p>{incoming.saveNames.join(' · ')}</p>
        </div>
      </div>

      <div className="incoming-row">
        <span className="incoming-row-icon">
          <Folder size={20} strokeWidth={1.8} />
        </span>
        <div>
          <span>These saves will land in</span>
          <strong title={incoming.destinationPath ?? undefined}>
            {incoming.destinationPath ?? 'Your inZOI SaveGames folder'}
          </strong>
        </div>
      </div>

      <div className="incoming-row">
        <span className="incoming-row-icon">
          <ShieldCheck size={21} strokeWidth={1.8} />
        </span>
        <div className="incoming-backup">
          <div>
            <strong>Back up matching saves</strong>
            <span>Keep the current copy before anything is replaced.</span>
          </div>
          <Toggle
            label="Back up matching saves"
            checked={backup}
            onChange={setBackup}
            disabled={answering}
          />
        </div>
      </div>

      <p className="incoming-warning">
        Only accept transfers from a PC you trust on your own network.
      </p>
    </Modal>
  )
}
