import { memo } from 'react'
import { Check, House } from 'lucide-react'
import type { SaveEntry } from '@shared/types'
import { formatBytes, formatSaveDate } from '../lib/format'

interface SaveCardProps {
  save: SaveEntry
  selected: boolean
  onToggle: () => void
}

export const SaveCard = memo(function SaveCard({ save, selected, onToggle }: SaveCardProps): JSX.Element {
  const densityRatio = Math.min(100, Math.max(18, Math.round((save.sizeBytes / (300 * 1024 * 1024)) * 100)))

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      className={`save-card glass-card accent-${save.accent} ${selected ? 'is-selected' : ''}`}
      onClick={onToggle}
      title={`${save.path}\n${save.fileCount.toLocaleString()} files${save.fingerprint ? ` · Hash ${save.fingerprint.slice(0, 8)}` : ''}`}
    >
      <div className="save-card-glow" aria-hidden="true" />
      <div className="save-card-top">
        <span className="save-icon">
          <House size={20} strokeWidth={2.1} aria-hidden="true" />
        </span>
        <span className={`save-world ${selected ? 'is-selected' : ''}`}>{save.world}</span>
        <span className={`save-check ${selected ? 'is-selected' : ''}`} aria-hidden="true">
          {selected && <Check size={14} strokeWidth={3.2} />}
        </span>
      </div>
      <div className="save-card-body">
        <h3>{save.title}</h3>
        <p>{formatSaveDate(save.modifiedAt)}</p>
        <div className="save-card-telemetry" aria-hidden="true">
          <div className="save-mini-bar">
            <span style={{ width: `${densityRatio}%` }} />
          </div>
          <div className="save-telemetry-meta">
            <span>{save.fileCount.toLocaleString()} files</span>
            {save.gameVersion ? <span>v{save.gameVersion}</span> : null}
          </div>
        </div>
      </div>
      <div className="save-card-footer">
        <span className="save-size">{formatBytes(save.sizeBytes)}</span>
        {selected ? (
          <span className="selected-pill">Selected</span>
        ) : (
          <span className="unselected-hint">Ready</span>
        )}
      </div>
    </button>
  )
})
