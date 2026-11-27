import { FolderOpen, RefreshCw, Sparkles } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { Hero } from '../components/Hero'
import { DeviceCard } from '../components/DeviceCard'
import { SourceNotice } from '../components/SourceNotice'
import { SaveCard } from '../components/SaveCard'
import { ReadyPanel } from '../components/ReadyPanel'
import { TransferFooter } from '../components/TransferFooter'
import { FolderBadgeArt } from '../illustrations/HeroIllustration'

export function TransferPage(): JSX.Element {
  const {
    saves,
    source,
    platform,
    selection,
    toggleSave,
    selectAll,
    clearSelection,
    refreshAll,
    refreshing,
    openModal,
    openFullDiskAccess
  } = useBridge()

  const allSelected = saves.length > 0 && saves.every((save) => selection.has(save.id))
  const folderLabel = platform === 'darwin' ? 'Mac' : 'PC'

  return (
    <div className="transfer-page">
      <Hero />
      <DeviceCard />
      <SourceNotice />

      <section className="saves-section" aria-labelledby="saves-heading">
        <div className="saves-heading">
          <div>
            <h2 id="saves-heading">Choose your saves</h2>
            <p>
              {source.permissionDenied
                ? 'Folder access needed before we can look inside.'
                : `${saves.length} ${saves.length === 1 ? 'save' : 'saves'} found on your ${folderLabel}`}
            </p>
          </div>
          <div className="saves-heading-actions">
            <button
              type="button"
              className="text-link select-all"
              onClick={allSelected ? clearSelection : selectAll}
              disabled={saves.length === 0}
            >
              {allSelected ? 'Clear selection' : 'Select all'}
            </button>
            <button
              type="button"
              className="refresh-button"
              onClick={() => void refreshAll()}
              aria-label="Refresh saves"
              title="Refresh saves"
              disabled={refreshing}
            >
              <RefreshCw size={19} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
        </div>

        <div className="saves-layout">
          <div className="saves-left">
            {saves.length > 0 ? (
              <div className="save-grid">
                {saves.map((save) => (
                  <SaveCard
                    key={save.id}
                    save={save}
                    selected={selection.has(save.id)}
                    onToggle={() => toggleSave(save.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="saves-empty">
                <div className="saves-empty-art">
                  <FolderBadgeArt />
                </div>
                <div className="saves-empty-copy">
                  <h3>
                    {source.permissionDenied
                      ? 'Your saves are just behind a permission'
                      : source.readable
                        ? 'No save folders here yet'
                        : 'Let’s find your inZOI saves'}
                  </h3>
                  <p>
                    {source.permissionDenied
                      ? 'Grant Full Disk Access to Save Bridge and refresh. We only read and copy — never delete.'
                      : source.readable
                        ? 'Create a save in inZOI, then come back and hit refresh. Your folder is ready and waiting.'
                        : 'Choose your SaveGames folder or let Save Bridge detect the App Store and Steam versions automatically.'}
                  </p>
                  <div className="saves-empty-actions">
                    {source.permissionDenied ? (
                      platform === 'darwin' ? (
                        <button type="button" className="button button-primary" onClick={() => void openFullDiskAccess()}>
                          Open Full Disk Access
                        </button>
                      ) : (
                        <button type="button" className="button button-primary" onClick={() => openModal('source')}>
                          <FolderOpen size={17} /> Choose folder
                        </button>
                      )
                    ) : (
                      <button type="button" className="button button-primary" onClick={() => openModal('source')}>
                        <FolderOpen size={17} /> Choose folder
                      </button>
                    )}
                    <button type="button" className="button button-ghost" onClick={() => void refreshAll()}>
                      <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh
                    </button>
                  </div>
                </div>
                <Sparkles className="empty-sparkle" size={22} aria-hidden="true" />
              </div>
            )}
            <p className="saves-footnote">
              Save folders are copied. Your originals stay on this {folderLabel}.
            </p>
          </div>
          <ReadyPanel />
        </div>
      </section>

      <TransferFooter />
    </div>
  )
}
