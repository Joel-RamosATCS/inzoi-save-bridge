import { ArrowRight, Check, Laptop, Loader2, Monitor, WifiOff } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { deviceKindLabel, platformName } from '../lib/format'

export function DeviceCard(): JSX.Element {
  const { platform, settings, source, selectedPeer, openModal, refreshing } = useBridge()
  const isMac = platform === 'darwin'
  const sourceEyebrow = isMac ? 'FROM · THIS MAC' : 'FROM · THIS PC'
  const destinationEyebrow = selectedPeer
    ? `TO · ${deviceKindLabel(selectedPeer.platform).toUpperCase()}`
    : 'TO · WINDOWS PC'
  const sourceStatus = source.permissionDenied
    ? 'Folder access needs permission'
    : source.readable
      ? `${platformName(platform)} · Save folder located`
      : source.exists
        ? 'Save folder is not readable'
        : 'Save folder not found'
  const peerStatus = selectedPeer
    ? selectedPeer.accepting
      ? 'connected'
      : 'idle'
    : 'searching'

  return (
    <section className={`device-card glass-panel ${peerStatus === 'searching' ? 'is-searching' : 'is-linked'}`}>
      <div className="device-side">
        <div className="device-icon lavender">
          <Laptop size={33} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="device-details">
          <p className="device-eyebrow">{sourceEyebrow}</p>
          <h2 title={settings.deviceName}>{settings.deviceName}</h2>
          <p className={`device-meta ${source.permissionDenied ? 'is-warning' : ''}`}>
            {sourceStatus}
          </p>
          <button type="button" className="text-link" onClick={() => openModal('source')}>
            Change folder
          </button>
        </div>
      </div>

      <div className="device-bridge">
        <div className="bridge-line" aria-hidden="true">
          <span className="bridge-beam" />
        </div>
        <div className="bridge-arrow">
          {refreshing ? (
            <Loader2 size={21} className="spin" aria-hidden="true" />
          ) : (
            <ArrowRight size={21} strokeWidth={2.2} aria-hidden="true" />
          )}
        </div>
        <p>Same Wi-Fi. No detours.</p>
        {selectedPeer?.rttMs ? (
          <span className="bridge-rtt">{selectedPeer.rttMs} ms · Direct TCP</span>
        ) : null}
      </div>

      <div className="device-side is-destination">
        <button type="button" className="device-change text-link" onClick={() => openModal('destination')}>
          Change
        </button>
        <div className="device-icon peach">
          <Monitor size={33} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="device-details">
          <p className="device-eyebrow">{destinationEyebrow}</p>
          <h2 title={selectedPeer?.name}>{selectedPeer?.name ?? 'Waiting for your PC'}</h2>
          <p className="device-meta">
            {selectedPeer
              ? `${selectedPeer.osVersion ?? platformName(selectedPeer.platform)}${selectedPeer.host ? ` · ${selectedPeer.host}` : ''}`
              : 'Open Save Bridge on your other PC'}
          </p>
          {selectedPeer ? (
            selectedPeer.accepting ? (
              <span className="status-pill is-online">
                <span className="status-led is-online" aria-hidden="true" />
                <Check size={13} strokeWidth={3} aria-hidden="true" />
                Connected
                {selectedPeer.rttMs ? <small>· {selectedPeer.rttMs}ms</small> : null}
              </span>
            ) : (
              <span className="status-pill is-idle">
                <span className="status-led is-idle" aria-hidden="true" />
                <WifiOff size={13} aria-hidden="true" />
                Not accepting
              </span>
            )
          ) : (
            <span className="status-pill is-searching">
              <span className="pulse-dot" aria-hidden="true" />
              Searching your network
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
