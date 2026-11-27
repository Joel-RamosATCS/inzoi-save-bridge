import { Activity, ShieldCheck, Wifi, Zap } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { HeroIllustration } from '../illustrations/HeroIllustration'

export function Hero(): JSX.Element {
  const { platform, engine, scanDurationMs, selectedPeer } = useBridge()

  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">Your world, wherever you play</p>
        <h1>Pick up where you left off.</h1>
        <p className="hero-subtitle">
          {platform === 'win32'
            ? 'Bring your inZOI saves from your Windows PC to another computer.'
            : 'Bring your inZOI saves from your Mac to your Windows PC.'}
        </p>
        <div className="hero-telemetry-bar">
          <span className="network-badge">
            <Wifi size={16} strokeWidth={2.1} aria-hidden="true" />
            Local network · Just between you
          </span>
          <span className="telemetry-chip is-rust">
            <Zap size={14} strokeWidth={2.2} aria-hidden="true" />
            <span>{engine === 'rust-native' ? 'Rust Native I/O' : 'Fast I/O'}</span>
            <strong>{scanDurationMs} ms</strong>
          </span>
          {selectedPeer?.rttMs ? (
            <span className="telemetry-chip is-online">
              <Activity size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Direct TCP</span>
              <strong>{selectedPeer.rttMs} ms</strong>
            </span>
          ) : (
            <span className="telemetry-chip">
              <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
              <span>Zero cloud</span>
              <strong>LAN only</strong>
            </span>
          )}
        </div>
      </div>
      <div className="hero-art-wrap">
        <HeroIllustration />
      </div>
    </section>
  )
}
