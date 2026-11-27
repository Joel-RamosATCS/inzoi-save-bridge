import { Check, Folder, ShieldCheck } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { deviceKindLabel, formatBytes, pluralize } from '../lib/format'
import { Toggle } from './Toggle'

export function ReadyPanel(): JSX.Element {
  const {
    selectedSaves,
    selectedBytes,
    selectedPeer,
    settings,
    updateSettings,
    openModal,
    saves
  } = useBridge()

  const count = selectedSaves.length
  const totalFiles = selectedSaves.reduce((sum, save) => sum + save.fileCount, 0)
  const totalAvailableBytes = Math.max(
    1,
    saves.reduce((sum, save) => sum + save.sizeBytes, 0)
  )
  const estSeconds = Math.max(0.2, Math.round((selectedBytes / (210 * 1024 * 1024)) * 10) / 10)
  const destination = selectedPeer
    ? `inZOI saves on ${deviceKindLabel(selectedPeer.platform).replace('Windows PC', 'Windows')}`
    : 'Choose a destination'
  const destinationPath = selectedPeer?.savesPath ?? undefined
  const backup = settings.backupBeforeReplacing

  return (
    <aside className="ready-panel glass-butter-panel">
      <h2>Ready for a new home.</h2>
      <div className="ready-summary">
        <span>
          {count === 0
            ? 'No saves selected'
            : `${count} ${pluralize(count, 'save')} selected`}
        </span>
        <strong>{formatBytes(selectedBytes)}</strong>
      </div>

      <div className="ready-telemetry-strip" aria-hidden="true">
        <div className="ready-segment-track">
          {selectedSaves.map((save) => {
            const pct = Math.max(8, Math.round((save.sizeBytes / totalAvailableBytes) * 100))
            return (
              <span
                key={save.id}
                className={`ready-segment accent-${save.accent}`}
                style={{ width: `${pct}%` }}
              />
            )
          })}
        </div>
        <div className="ready-telemetry-labels">
          <span>{totalFiles.toLocaleString()} files queued</span>
          <span>{count > 0 ? `~${estSeconds}s on LAN` : 'Instant stream'}</span>
        </div>
      </div>

      <div className="ready-divider" />

      <div className="ready-row">
        <span className="ready-row-icon">
          <Folder size={21} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="ready-row-copy">
          <p>Destination folder</p>
          <strong title={destinationPath}>{destination}</strong>
        </div>
        <button type="button" className="text-link" onClick={() => openModal('destination')}>
          Change
        </button>
      </div>

      <div className="ready-row">
        <span className="ready-row-icon">
          <ShieldCheck size={22} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="ready-row-copy">
          <strong className="ready-toggle-title">Back up before replacing</strong>
          <p>Keep a copy of any matching saves.</p>
        </div>
        <Toggle
          label="Back up before replacing"
          checked={backup}
          onChange={(checked) => void updateSettings({ backupBeforeReplacing: checked })}
        />
      </div>

      <div className={`ready-note ${backup ? 'is-safe' : 'is-warn'}`}>
        <span className="ready-note-check">
          <Check size={14} strokeWidth={3} aria-hidden="true" />
        </span>
        <span>
          {backup
            ? count > 0
              ? 'Your progress stays protected.'
              : 'Backups are on for your next transfer.'
            : count > 0
              ? 'Matching saves will be replaced.'
              : 'Backups are off.'}
        </span>
      </div>

      {saves.length === 0 && (
        <p className="ready-empty">
          Pick a save folder above and your saves will show up here, ready to travel.
        </p>
      )}
    </aside>
  )
}
