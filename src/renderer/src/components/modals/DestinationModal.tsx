import { useEffect, useState, type FormEvent } from 'react'
import {
  Check,
  Laptop,
  Loader2,
  Monitor,
  Network,
  RefreshCw,
  Wifi,
  WifiOff
} from 'lucide-react'
import { useBridge } from '../../state/BridgeProvider'
import { Modal } from '../Modal'
import { platformName } from '../../lib/format'
import type { Peer } from '@shared/types'

function DeviceIcon({ peer }: { peer: Peer }): JSX.Element {
  return peer.platform === 'darwin' ? (
    <Laptop size={22} strokeWidth={1.8} />
  ) : (
    <Monitor size={22} strokeWidth={1.8} />
  )
}

export function DestinationModal(): JSX.Element | null {
  const {
    modal,
    closeModal,
    peers,
    selectedPeerId,
    selectPeer,
    connectManually,
    refreshAll,
    refreshing,
    settings
  } = useBridge()
  const [draft, setDraft] = useState<string | null>(selectedPeerId)
  const [host, setHost] = useState(settings.manualPeerHost ?? '')
  const [port, setPort] = useState(String(settings.manualPeerPort ?? 47772))
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (modal !== 'destination') return
    setDraft(selectedPeerId)
    setHost(settings.manualPeerHost ?? '')
    setPort(String(settings.manualPeerPort ?? 47772))
    setError(null)
  }, [modal, selectedPeerId, settings.manualPeerHost, settings.manualPeerPort])

  if (modal !== 'destination') return null

  const apply = async (): Promise<void> => {
    if (!draft) return
    setApplied(true)
    try {
      await selectPeer(draft)
      closeModal()
    } finally {
      setApplied(false)
    }
  }

  const connect = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const portNumber = Number(port)
    if (!host.trim()) {
      setError('Enter the IP address shown in Save Bridge on the other PC.')
      return
    }
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError('That port does not look right. The default is 47772.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const peer = await connectManually(host.trim(), portNumber)
      if (peer) {
        setDraft(peer.instanceId)
      } else {
        setError('No Save Bridge answered at that address. Check both devices are on the same Wi-Fi.')
      }
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Modal
      title="Choose your other PC"
      eyebrow="Destination"
      subtitle="Both devices need Save Bridge open and a connection to the same Wi-Fi network."
      icon={<Network size={24} />}
      onClose={closeModal}
      size="wide"
      footer={
        <>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
          <div className="modal-footer-spacer" />
          <button type="button" className="button button-ghost" onClick={closeModal}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void apply()}
            disabled={!draft || peers.length === 0 || applied}
          >
            Use this PC
          </button>
        </>
      }
    >
      {peers.length > 0 ? (
        <div className="peer-list">
          {peers.map((peer) => {
            const active = draft === peer.instanceId
            return (
              <button
                key={peer.instanceId}
                type="button"
                className={`peer-row ${active ? 'is-selected' : ''}`}
                onClick={() => setDraft(peer.instanceId)}
              >
                <span className="peer-icon">
                  <DeviceIcon peer={peer} />
                </span>
                <span className="peer-copy">
                  <span className="peer-name">
                    {peer.name}
                    {peer.manual && <span className="peer-tag">Manual</span>}
                  </span>
                  <span className="peer-meta">
                    {peer.osVersion ?? platformName(peer.platform)}
                    {peer.host ? ` · ${peer.host}` : ''}
                  </span>
                </span>
                <span className={`peer-status ${peer.accepting ? 'is-online' : 'is-offline'}`}>
                  {peer.accepting ? <Wifi size={13} /> : <WifiOff size={13} />}
                  {peer.accepting ? 'Connected' : 'Not accepting'}
                </span>
                <span className={`peer-radio ${active ? 'is-on' : ''}`}>
                  {active && <Check size={13} strokeWidth={3} />}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="peer-empty">
          <div className="peer-empty-art">
            <Wifi size={30} strokeWidth={1.6} />
          </div>
          <h3>No PC found yet</h3>
          <p>
            Open inZOI Save Bridge on your Windows PC. Keep both devices on the same Wi-Fi and give
            discovery a moment — or connect by IP below.
          </p>
        </div>
      )}

      <p className="destination-hint">
        The destination folder is set on that PC under <strong>Settings → Receiving into</strong>.
      </p>

      <div className="manual-connect">
        <div className="manual-head">
          <h3>Connect by IP</h3>
          <p>Useful when discovery is blocked by a firewall. The address is under Settings → This device on the other PC.</p>
        </div>
        <form className="manual-form" onSubmit={(event) => void connect(event)}>
          <label className="field">
            <span>IP address or hostname</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="192.168.1.24"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="field is-port">
            <span>Port</span>
            <input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              inputMode="numeric"
              placeholder="47772"
            />
          </label>
          <button type="submit" className="button button-secondary" disabled={connecting}>
            {connecting ? <Loader2 size={16} className="spin" /> : <Network size={16} />}
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </form>
        {error && (
          <p className="form-error">
            <WifiOff size={15} /> {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
