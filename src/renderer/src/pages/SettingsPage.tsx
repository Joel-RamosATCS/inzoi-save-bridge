import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Cpu,
  FolderOpen,
  HardDrive,
  Info,
  Laptop,
  Lock,
  Monitor,
  Moon,
  Network,
  ShieldCheck,
  Sparkles,
  Sun,
  Wifi
} from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { Toggle } from '../components/Toggle'
import { platformName, shortPath } from '../lib/format'
import type { AppSettings, GlassIntensity, GlassPreset, ThemeMode } from '@shared/types'

const GLASS_PRESETS: Array<{
  id: GlassPreset
  name: string
  tagline: string
  swatch: string
}> = [
  {
    id: 'amethyst',
    name: 'Amethyst Mist',
    tagline: 'Soft violet & warm champagne',
    swatch: 'linear-gradient(135deg, #8b67e8, #e8c48e)'
  },
  {
    id: 'emerald',
    name: 'Emerald Field',
    tagline: 'Botanical olive & luminous lime',
    swatch: 'linear-gradient(135deg, #84cc16, #2f5e41)'
  },
  {
    id: 'aurora',
    name: 'Aurora Frost',
    tagline: 'Icy cyan, indigo & soft rose',
    swatch: 'linear-gradient(135deg, #38bdf8, #818cf8, #e879f9)'
  },
  {
    id: 'obsidian',
    name: 'Obsidian Crystal',
    tagline: 'Pure smoked glass & silver rim',
    swatch: 'linear-gradient(135deg, #94a3b8, #334155)'
  }
]

const GLASS_INTENSITIES: Array<{ id: GlassIntensity; label: string; blur: string }> = [
  { id: 'subtle', label: 'Subtle', blur: '18px' },
  { id: 'balanced', label: 'Balanced', blur: '30px' },
  { id: 'ultra', label: 'Ultra Glass', blur: '46px' }
]

export function SettingsPage(): JSX.Element {
  const {
    settings,
    appVersion,
    platform,
    source,
    localDestination,
    dataDir,
    receiverPort,
    localAddresses,
    engine,
    scanDurationMs,
    updateSettings,
    refreshAll,
    notify,
    openModal,
    chooseDestination,
    resetSource,
    openPath,
    openFullDiskAccess,
    demo
  } = useBridge()
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [savedRecently, setSavedRecently] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const setField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setSavedRecently(false)
  }

  const applyAppearanceLive = (patch: Partial<AppSettings>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    void updateSettings(patch)
  }

  const save = async (): Promise<void> => {
    if (!draft.deviceName.trim()) {
      notify('error', 'Give this device a name', 'Your other PC uses it to recognise you.')
      return
    }
    if (!Number.isInteger(draft.port) || draft.port < 1024 || draft.port > 65535) {
      notify('error', 'That port will not work', 'Choose a number between 1024 and 65535.')
      return
    }
    setSaving(true)
    try {
      await updateSettings({ ...draft, deviceName: draft.deviceName.trim() })
      await refreshAll()
      setSavedRecently(true)
      notify('success', 'Settings saved')
    } finally {
      setSaving(false)
    }
  }

  const activePreset: GlassPreset = draft.glassPreset ?? 'amethyst'
  const activeIntensity: GlassIntensity = draft.glassIntensity ?? 'ultra'
  const activeSpecular = draft.specularRim ?? true
  const activeAmbient = draft.ambientMotion ?? true

  return (
    <div className="standard-page settings-page">
      <header className="page-intro">
        <p className="eyebrow">Settings</p>
        <h1>Make it feel like home.</h1>
        <p className="page-subtitle">
          Liquid glass materials, save folders, and local network tuning. Appearance changes apply
          instantly.
        </p>
      </header>

      <div className="settings-columns">
        <div className="settings-column">
          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon lavender">
                <Laptop size={20} />
              </span>
              <div>
                <h2>This device</h2>
                <p>How your other PC sees you on the network.</p>
              </div>
            </div>
            <label className="field">
              <span>Device name</span>
              <input
                value={draft.deviceName}
                maxLength={60}
                onChange={(event) => setField('deviceName', event.target.value)}
              />
            </label>
            <div className="network-address">
              <div>
                <span>Your network address</span>
                <code>
                  {localAddresses[0]
                    ? `${localAddresses[0]}:${receiverPort || 47772}`
                    : 'No local network connection'}
                </code>
              </div>
              <button
                type="button"
                className="copy-button"
                aria-label="Copy network address"
                disabled={!localAddresses[0]}
                onClick={async () => {
                  try {
                    await window.saveBridge.copyText(
                      `${localAddresses[0]}:${receiverPort || 47772}`
                    )
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1800)
                  } catch {
                    notify('error', 'Could not copy the address')
                  }
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="field-hint">
              {platformName(platform)} · inZOI Save Bridge {appVersion}
              {demo ? ' · preview mode' : ''}
            </p>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon butter">
                <FolderOpen size={20} />
              </span>
              <div>
                <h2>Save folders</h2>
                <p>Where inZOI keeps your worlds on this device.</p>
              </div>
            </div>

            <div className="folder-setting">
              <div className="folder-setting-top">
                <div>
                  <span className="folder-label">Sending from</span>
                  <strong>{source.label}</strong>
                </div>
                <div className="folder-actions">
                  <button type="button" className="text-link" onClick={() => openModal('source')}>
                    Change
                  </button>
                  <button
                    type="button"
                    className="text-link is-muted"
                    onClick={() => void resetSource()}
                  >
                    Auto-detect
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="folder-path-button"
                title={source.path ?? undefined}
                onClick={() => source.path && void openPath(source.path)}
                disabled={!source.path}
              >
                <FolderOpen size={14} />
                {source.path ? shortPath(source.path, 74) : 'No folder detected yet'}
              </button>
              <div className="folder-chips">
                {source.candidates.map((candidate) => (
                  <span
                    key={candidate.id}
                    className={`folder-chip ${candidate.exists && candidate.readable ? 'is-ok' : candidate.exists ? 'is-warning' : ''}`}
                  >
                    <span className="chip-dot" />
                    {candidate.label}
                    {candidate.exists && candidate.readable
                      ? ' · found'
                      : candidate.exists
                        ? ' · no access'
                        : ' · not found'}
                  </span>
                ))}
              </div>
            </div>

            <div className="folder-setting">
              <div className="folder-setting-top">
                <div>
                  <span className="folder-label">Receiving into</span>
                  <strong>inZOI SaveGames</strong>
                </div>
                <div className="folder-actions">
                  <button type="button" className="text-link" onClick={() => void chooseDestination()}>
                    Change
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="folder-path-button"
                title={localDestination.path ?? undefined}
                onClick={() => localDestination.path && void openPath(localDestination.path)}
                disabled={!localDestination.path}
              >
                <HardDrive size={14} />
                {localDestination.path ? shortPath(localDestination.path, 74) : 'No folder available'}
              </button>
              <p className="field-hint">
                Incoming saves from other devices are written here. Matching saves are backed up when
                the backup option is on.
              </p>
            </div>

            {platform === 'darwin' && (
              <button type="button" className="permission-link" onClick={() => void openFullDiskAccess()}>
                <ShieldCheck size={16} />
                <span>
                  <strong>Full Disk Access</strong>
                  <small>Needed for the Mac App Store version’s protected folder.</small>
                </span>
                <span className="permission-link-arrow">Open</span>
              </button>
            )}
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-icon blush">
                <Network size={20} />
              </span>
              <div>
                <h2>Transfers</h2>
                <p>Local network behaviour and the safety net.</p>
              </div>
            </div>

            <div className="setting-row">
              <div>
                <strong>Back up before replacing</strong>
                <p>Keep the destination’s existing save in a hidden backup folder.</p>
              </div>
              <Toggle
                label="Back up before replacing"
                checked={draft.backupBeforeReplacing}
                onChange={(value) => setField('backupBeforeReplacing', value)}
              />
            </div>

            <div className="setting-row">
              <div>
                <strong>Ask before accepting transfers</strong>
                <p>Show a confirmation whenever another device wants to send saves here.</p>
              </div>
              <Toggle
                label="Ask before accepting transfers"
                checked={draft.askBeforeAccepting}
                onChange={(value) => setField('askBeforeAccepting', value)}
              />
            </div>

            <div className="setting-row">
              <div>
                <strong>Find devices on this Wi-Fi</strong>
                <p>Broadcast a tiny presence signal on your local network. No cloud involved.</p>
              </div>
              <Toggle
                label="Find devices on this Wi-Fi"
                checked={draft.discoveryEnabled}
                onChange={(value) => setField('discoveryEnabled', value)}
              />
            </div>

            <label className="field is-inline">
              <span>
                Transfer port
                <small>Both devices use this to talk. Change it only if something else needs 47772.</small>
              </span>
              <input
                className="port-input"
                value={String(draft.port)}
                inputMode="numeric"
                onChange={(event) => {
                  const value = Number(event.target.value.replace(/[^0-9]/g, ''))
                  setField('port', Number.isFinite(value) ? value : 0)
                }}
              />
            </label>
            <p className="field-hint">
              {receiverPort > 0
                ? `Currently listening on port ${receiverPort}${receiverPort !== draft.port ? ` — configured ${draft.port} was busy.` : '.'}`
                : 'The receiver is not listening. Check the port and your firewall, then save settings.'}
            </p>

            <div className="settings-note">
              <Wifi size={17} />
              <p>
                Keep both devices on the same Wi-Fi. A macOS or Windows firewall prompt may appear the
                first time — allowing access lets the two apps discover each other.
              </p>
            </div>
          </section>
        </div>

        <div className="settings-column">
          <section className="settings-card glass-studio-card">
            <div className="settings-card-head">
              <span className="settings-icon lavender">
                <Sparkles size={20} />
              </span>
              <div>
                <h2>Liquid Glass & Appearance</h2>
                <p>Refractive translucency, surface tint, and backdrop depth.</p>
              </div>
            </div>

            <div className="glass-subsection">
              <span className="glass-sublabel">Color mode</span>
              <div className="theme-segment" role="radiogroup" aria-label="Theme">
                {(
                  [
                    { id: 'light', label: 'Light Glass', icon: <Sun size={15} /> },
                    { id: 'dark', label: 'Dark Glass', icon: <Moon size={15} /> },
                    { id: 'system', label: 'System', icon: <Monitor size={15} /> }
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.theme === option.id}
                    className={draft.theme === option.id ? 'is-active' : ''}
                    onClick={() => applyAppearanceLive({ theme: option.id as ThemeMode })}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-subsection">
              <span className="glass-sublabel">Glass material preset</span>
              <div className="glass-preset-grid" role="radiogroup" aria-label="Glass preset">
                {GLASS_PRESETS.map((preset) => {
                  const selected = activePreset === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`glass-preset-card ${selected ? 'is-selected' : ''}`}
                      onClick={() => applyAppearanceLive({ glassPreset: preset.id })}
                    >
                      <span
                        className="preset-swatch"
                        style={{ background: preset.swatch }}
                        aria-hidden="true"
                      />
                      <span className="preset-copy">
                        <strong>{preset.name}</strong>
                        <small>{preset.tagline}</small>
                      </span>
                      {selected && (
                        <span className="preset-check" aria-hidden="true">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="glass-subsection">
              <span className="glass-sublabel">Frost & blur intensity</span>
              <div className="theme-segment" role="radiogroup" aria-label="Glass intensity">
                {GLASS_INTENSITIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={activeIntensity === item.id}
                    className={activeIntensity === item.id ? 'is-active' : ''}
                    onClick={() => applyAppearanceLive({ glassIntensity: item.id })}
                  >
                    <span>{item.label}</span>
                    <small className="segment-sub">{item.blur}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <div>
                <strong>3D specular rim & light refraction</strong>
                <p>Crisp top-edge light reflection and inner glass bevel on cards.</p>
              </div>
              <Toggle
                label="3D specular rim & light refraction"
                checked={activeSpecular}
                onChange={(value) => applyAppearanceLive({ specularRim: value })}
              />
            </div>

            <div className="setting-row">
              <div>
                <strong>Ambient refracted light orbs</strong>
                <p>Soft floating color pools behind frosted glass surfaces.</p>
              </div>
              <Toggle
                label="Ambient refracted light orbs"
                checked={activeAmbient}
                onChange={(value) => applyAppearanceLive({ ambientMotion: value })}
              />
            </div>
          </section>

          <section className="settings-card privacy-card">
            <div className="settings-card-head">
              <span className="settings-icon mint">
                <Lock size={20} />
              </span>
              <div>
                <h2>Private by design</h2>
                <p>Your worlds never leave your local network.</p>
              </div>
            </div>
            <ul className="privacy-list">
              <li>
                <Check size={15} /> No accounts, telemetry, or cloud storage
              </li>
              <li>
                <Check size={15} /> Saves are copied — originals are never deleted
              </li>
              <li>
                <Check size={15} /> Backups are kept next to your SaveGames folder
              </li>
              <li>
                <Check size={15} /> Transfers only run while both devices are awake
              </li>
            </ul>
          </section>

          <section className="settings-card about-card">
            <div className="settings-card-head">
              <span className="settings-icon butter">
                <Info size={20} />
              </span>
              <div>
                <h2>About & Native Engine</h2>
                <p>inZOI Save Bridge {appVersion}</p>
              </div>
            </div>
            <div className="about-rows">
              <div>
                <span>Platform</span>
                <strong>{platformName(platform)}</strong>
              </div>
              <div>
                <span>Scanner & I/O Engine</span>
                <strong className="engine-status-inline">
                  <Cpu size={13} />
                  {engine === 'rust-native' ? `Rust Native Daemon (${scanDurationMs}ms)` : 'Node Fallback'}
                </strong>
              </div>
              <div>
                <span>Transfer Protocol</span>
                <strong>Batch v3 · 6× Concurrent TCP_NODELAY</strong>
              </div>
              <div>
                <span>Discovery</span>
                <strong>{draft.discoveryEnabled ? 'Local Wi-Fi (UDP 47771)' : 'Manual only'}</strong>
              </div>
              <div>
                <span>App data</span>
                <button type="button" className="text-link" onClick={() => void openPath(dataDir)}>
                  Open folder
                </button>
              </div>
            </div>
            <p className="about-note">
              Built for moving inZOI saves between Mac and Windows. Not affiliated with KRAFTON.
            </p>
          </section>
        </div>
      </div>

      <div className={`settings-savebar ${dirty ? 'is-dirty' : ''}`}>
        <div>
          {dirty ? (
            <>
              <strong>You have unsaved changes</strong>
              <p>Appearance and folders apply live; click Save for device name or port.</p>
            </>
          ) : (
            <>
              <strong className="saved-line">
                <Check size={15} strokeWidth={3} />{' '}
                {savedRecently ? 'Settings saved' : 'Everything is up to date'}
              </strong>
              <p>Changes are stored locally on this device.</p>
            </>
          )}
        </div>
        {dirty && (
          <div className="settings-save-actions">
            <button type="button" className="button button-ghost" onClick={() => setDraft(settings)}>
              Discard
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
        {!dirty && (
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void openPath(dataDir)}
          >
            <FolderOpen size={16} /> App data
          </button>
        )}
      </div>
    </div>
  )
}
