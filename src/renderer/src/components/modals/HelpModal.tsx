import { Check, FolderOpen, Lock, ShieldCheck, Wifi } from 'lucide-react'
import { useBridge } from '../../state/BridgeProvider'
import { Modal } from '../Modal'

export function HelpModal(): JSX.Element | null {
  const {
    modal,
    closeModal,
    source,
    openFullDiskAccess,
    openPath,
    platform
  } = useBridge()

  if (modal !== 'help') return null

  return (
    <Modal
      title="You're in good hands."
      eyebrow="Need a hand?"
      subtitle="Moving an inZOI save takes about a minute. Here is the short version."
      icon={<ShieldCheck size={24} />}
      onClose={closeModal}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="button button-primary" onClick={closeModal}>
            Got it
          </button>
        </>
      }
    >
      <ol className="help-steps">
        <li>
          <span className="help-step-number">1</span>
          <div>
            <h3>Find your saves</h3>
            <p>
              Save Bridge detects the App Store and Steam folders on your Mac automatically. Use
              “Change folder” if your world lives somewhere else.
            </p>
          </div>
        </li>
        <li>
          <span className="help-step-number">2</span>
          <div>
            <h3>Pick the worlds you want</h3>
            <p>Select as many saves as you like. Originals always stay on this device.</p>
          </div>
        </li>
        <li>
          <span className="help-step-number">3</span>
          <div>
            <h3>Send over the local network</h3>
            <p>
              Open Save Bridge on your other PC, keep both on the same Wi-Fi, then hit “Transfer”.
              Nothing touches the internet.
            </p>
          </div>
        </li>
      </ol>

      <div className="help-pills">
        <span>
          <Wifi size={15} /> Same Wi-Fi only
        </span>
        <span>
          <Lock size={15} /> No cloud, no accounts
        </span>
        <span>
          <Check size={15} /> Originals never deleted
        </span>
      </div>

      <div className="help-actions">
        {source.path && (
          <button type="button" className="button button-ghost" onClick={() => void openPath(source.path as string)}>
            <FolderOpen size={16} /> Open my save folder
          </button>
        )}
        {platform === 'darwin' && (
          <button type="button" className="button button-ghost" onClick={() => void openFullDiskAccess()}>
            <ShieldCheck size={16} /> Full Disk Access
          </button>
        )}
      </div>

      <p className="help-footnote">
        A firewall prompt may appear the first time. Allow Save Bridge to communicate on your local
        network so the two devices can find each other.
      </p>
    </Modal>
  )
}
