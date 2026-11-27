import { useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  Clock,
  FolderOpen,
  HardDrive,
  Trash2
} from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { Modal } from '../components/Modal'
import { FolderBadgeArt } from '../illustrations/HeroIllustration'
import {
  formatBytes,
  formatHistoryDate,
  friendlySaveName,
  platformName,
  pluralize,
  shortPath
} from '../lib/format'

export function HistoryPage(): JSX.Element {
  const { history, clearHistory, setPage, openPath, selectedPeer } = useBridge()
  const [confirming, setConfirming] = useState(false)

  const stats = useMemo(() => {
    const completed = history.filter((record) => record.status === 'completed')
    const bytes = completed.reduce((sum, record) => sum + record.totalBytes, 0)
    const last = completed[0]
    return {
      transfers: completed.length,
      bytes,
      last
    }
  }, [history])

  const destinationLabel = selectedPeer?.name ?? 'your other PC'

  return (
    <div className="standard-page history-page">
      <header className="page-intro">
        <p className="eyebrow">Transfer history</p>
        <h1>Every save, safely delivered.</h1>
        <p className="page-subtitle">
          A quiet little receipt of everywhere your worlds have been. Nothing here leaves this
          device.
        </p>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-icon lavender">
            <ArrowUpFromLine size={20} />
          </span>
          <div>
            <span className="stat-label">Completed transfers</span>
            <strong>{stats.transfers}</strong>
            <p>{history.filter((record) => record.direction === 'outgoing').length} sent out</p>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon butter">
            <HardDrive size={20} />
          </span>
          <div>
            <span className="stat-label">Data moved</span>
            <strong>{formatBytes(stats.bytes)}</strong>
            <p>Across {stats.transfers} {pluralize(stats.transfers, 'delivery', 'deliveries')}</p>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon blush">
            <Clock size={20} />
          </span>
          <div>
            <span className="stat-label">Last delivery</span>
            <strong className="stat-date">
              {stats.last ? formatHistoryDate(stats.last.at).split(',')[0] : 'Not yet'}
            </strong>
            <p>{stats.last ? stats.last.peerName : 'Your first transfer is waiting'}</p>
          </div>
        </div>
      </div>

      <div className="history-head">
        <div>
          <h2>Recent transfers</h2>
          <p>{history.length > 0 ? `${history.length} ${pluralize(history.length, 'record')}` : 'A fresh start'}</p>
        </div>
        {history.length > 0 && (
          <button type="button" className="button button-ghost button-small" onClick={() => setConfirming(true)}>
            <Trash2 size={15} /> Clear history
          </button>
        )}
      </div>

      {history.length > 0 ? (
        <div className="history-list">
          {history.map((record) => {
            const outgoing = record.direction === 'outgoing'
            const count = record.saveNames.length
            return (
              <article key={record.id} className="history-row">
                <span className={`history-icon ${outgoing ? 'is-outgoing' : 'is-incoming'}`}>
                  {outgoing ? <ArrowUpFromLine size={21} /> : <ArrowDownToLine size={21} />}
                </span>
                <div className="history-main">
                  <div className="history-title">
                    <strong>
                      {count === 1
                        ? friendlySaveName(record.saveNames[0])
                        : `${count} saves delivered`}
                    </strong>
                    <span className={`history-status is-${record.status}`}>
                      {record.status === 'completed' ? <Check size={12} strokeWidth={3} /> : null}
                      {record.status === 'completed' ? 'Delivered' : record.status === 'failed' ? 'Failed' : 'Cancelled'}
                    </span>
                  </div>
                  <p className="history-saves" title={record.saveNames.join('\n')}>
                    {outgoing ? `To ${record.peerName}` : `From ${record.peerName}`}
                    {count > 1
                      ? ` · ${record.saveNames.slice(0, 2).map(friendlySaveName).join(' · ')}${count > 2 ? ` +${count - 2}` : ''}`
                      : ''}
                  </p>
                  {record.direction === 'incoming' ? (
                    <button
                      type="button"
                      className="history-path"
                      title={record.folderPath}
                      onClick={() => void openPath(record.folderPath)}
                    >
                      <FolderOpen size={13} /> {shortPath(record.folderPath, 62)}
                    </button>
                  ) : (
                    <span className="history-path is-static" title={record.folderPath}>
                      <FolderOpen size={13} /> {shortPath(record.folderPath, 62)}
                    </span>
                  )}
                </div>
                <div className="history-side">
                  <span className="history-size">{formatBytes(record.totalBytes)}</span>
                  <span className="history-date">{formatHistoryDate(record.at)}</span>
                  <span className="history-platform">{platformName(record.peerPlatform)}</span>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="history-empty">
          <div className="history-empty-art">
            <FolderBadgeArt />
          </div>
          <div>
            <h3>{destinationLabel} is still waiting</h3>
            <p>
              Once you send or receive a save, the receipt will appear here with the date, size, and
              destination folder.
            </p>
            <button type="button" className="button button-primary" onClick={() => setPage('transfer')}>
              Go to Transfer <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <Modal
          title="Clear transfer history?"
          eyebrow="History"
          subtitle="This only clears the receipt list. Your save files and backups stay exactly where they are."
          icon={<Trash2 size={23} />}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <div className="modal-footer-spacer" />
              <button type="button" className="button button-ghost" onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => {
                  void clearHistory()
                  setConfirming(false)
                }}
              >
                Clear history
              </button>
            </>
          }
        >
          <p className="confirm-copy">
            {history.length} {pluralize(history.length, 'receipt')} will be removed from this device.
          </p>
        </Modal>
      )}
    </div>
  )
}
