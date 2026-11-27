import { AlertCircle, Check, ChevronRight, FolderOpen, HardDrive, RefreshCw } from 'lucide-react'
import { useBridge } from '../../state/BridgeProvider'
import { Modal } from '../Modal'
import type { SaveFolderCandidate } from '@shared/types'

function CandidateStatus({ candidate, active }: { candidate: SaveFolderCandidate; active: boolean }): JSX.Element {
  if (active) {
    return (
      <span className="candidate-pill is-active">
        <Check size={12} strokeWidth={3} /> In use
      </span>
    )
  }
  if (!candidate.exists) return <span className="candidate-pill">Not found</span>
  if (!candidate.readable) {
    return (
      <span className="candidate-pill is-warning">
        <AlertCircle size={12} /> No access
      </span>
    )
  }
  return <span className="candidate-pill is-ok">Found</span>
}

export function SourceModal(): JSX.Element | null {
  const {
    source,
    platform,
    modal,
    closeModal,
    useSourceCandidate,
    chooseSource,
    resetSource,
    openFullDiskAccess,
    openPath
  } = useBridge()

  if (modal !== 'source') return null

  return (
    <Modal
      title="Where are your saves?"
      eyebrow="Save folder"
      subtitle={
        platform === 'darwin'
          ? 'Save Bridge looks in both the App Store container and your Documents folder. Pick the one inZOI is using.'
          : 'Save Bridge looks in your Documents folder. Pick the folder inZOI is using.'
      }
      icon={<FolderOpen size={24} />}
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="button button-ghost" onClick={() => void resetSource()}>
            <RefreshCw size={16} /> Auto-detect
          </button>
          <div className="modal-footer-spacer" />
          <button type="button" className="button button-ghost" onClick={() => void chooseSource()}>
            Choose another folder…
          </button>
        </>
      }
    >
      <div className="candidate-list">
        {source.candidates.map((candidate) => {
          const active = Boolean(source.path && candidate.path === source.path)
          return (
            <button
              key={candidate.id}
              type="button"
              className={`candidate-row ${active ? 'is-active' : ''}`}
              onClick={() => void useSourceCandidate(candidate.id)}
            >
              <span className="candidate-icon">
                <HardDrive size={21} strokeWidth={1.8} />
              </span>
              <span className="candidate-copy">
                <span className="candidate-name">{candidate.label}</span>
                <span className="candidate-path" title={candidate.path}>
                  {candidate.path}
                </span>
              </span>
              <CandidateStatus candidate={candidate} active={active} />
              <ChevronRight size={18} className="candidate-chevron" />
            </button>
          )
        })}
      </div>

      {source.path && (
        <button
          type="button"
          className="inline-folder-link"
          onClick={() => void openPath(source.path as string)}
        >
          <FolderOpen size={15} /> Open the selected folder in {platform === 'darwin' ? 'Finder' : 'Explorer'}
        </button>
      )}

      {platform === 'darwin' && (
        <div className="modal-note">
          <AlertCircle size={18} />
          <div>
            <strong>A note about the Mac App Store version</strong>
            <p>
              macOS protects the inZOI container. If the App Store folder is blocked, grant inZOI Save
              Bridge Full Disk Access, then try again. Nothing is uploaded anywhere.
            </p>
            <button type="button" className="text-link" onClick={() => void openFullDiskAccess()}>
              Open Full Disk Access settings
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
