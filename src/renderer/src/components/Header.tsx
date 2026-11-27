import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Cpu,
  HelpCircle,
  Monitor,
  Moon,
  Sparkles,
  Sun
} from 'lucide-react'
import type { GlassIntensity, GlassPreset, ThemeMode } from '@shared/types'
import { useBridge, type Page } from '../state/BridgeProvider'

const items: { id: Page; label: string }[] = [
  { id: 'transfer', label: 'Transfer' },
  { id: 'history', label: 'Transfer history' },
  { id: 'settings', label: 'Settings' }
]

const PRESETS: Array<{ id: GlassPreset; label: string; swatch: string }> = [
  {
    id: 'amethyst',
    label: 'Amethyst Mist',
    swatch: 'linear-gradient(135deg, #8b67e8, #e8c48e)'
  },
  {
    id: 'emerald',
    label: 'Emerald Field',
    swatch: 'linear-gradient(135deg, #84cc16, #2f5e41)'
  },
  {
    id: 'aurora',
    label: 'Aurora Frost',
    swatch: 'linear-gradient(135deg, #38bdf8, #818cf8, #e879f9)'
  },
  {
    id: 'obsidian',
    label: 'Obsidian Crystal',
    swatch: 'linear-gradient(135deg, #94a3b8, #334155)'
  }
]

const presetShortNames: Record<GlassPreset, string> = {
  amethyst: 'Amethyst',
  emerald: 'Emerald',
  aurora: 'Aurora',
  obsidian: 'Obsidian'
}

export function Header(): JSX.Element {
  const { page, setPage, openModal, settings, updateSettings, engine, scanDurationMs } = useBridge()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isDark =
    settings.theme === 'dark' ||
    (settings.theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const currentPreset: GlassPreset = settings.glassPreset ?? 'amethyst'
  const currentIntensity: GlassIntensity = settings.glassIntensity ?? 'ultra'

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const toggleTheme = (): void => {
    void updateSettings({ theme: isDark ? 'light' : 'dark' })
  }

  return (
    <header className="app-header">
      <div className="brand">
        <button
          type="button"
          className="brand-name"
          onClick={() => setPage('transfer')}
          aria-label="inZOI Save Bridge home"
        >
          <span className="brand-in">in</span>ZOI
        </button>
        <span className="brand-badge">save bridge</span>
      </div>

      <nav className="main-nav glass-dock" aria-label="Main">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${page === item.id ? 'is-active' : ''}`}
            onClick={() => setPage(item.id)}
            aria-current={page === item.id ? 'page' : undefined}
          >
            {page === item.id && <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="header-help">
        <span
          className="engine-pill"
          title={`Powered by ${engine === 'rust-native' ? 'native Rust daemon (inzoi-core)' : 'Node scanner'} · last scan ${scanDurationMs} ms`}
        >
          <Cpu size={13} strokeWidth={2.1} aria-hidden="true" />
          <span>{engine === 'rust-native' ? 'Rust' : 'Core'}</span>
          <code>{scanDurationMs}ms</code>
        </span>

        <div className="glass-menu-anchor" ref={menuRef}>
          <button
            type="button"
            className={`glass-preset-pill ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            title="Customize Liquid Glass theme & preset"
          >
            <Sparkles size={13} strokeWidth={2.1} aria-hidden="true" />
            <span>{presetShortNames[currentPreset]}</span>
            <ChevronDown size={12} strokeWidth={2.2} aria-hidden="true" />
          </button>

          {menuOpen && (
            <div className="glass-quick-popover" role="dialog" aria-label="Liquid Glass quick theme">
              <div className="glass-popover-section">
                <span className="glass-popover-label">Mode</span>
                <div className="glass-popover-modes">
                  {(
                    [
                      { id: 'light', label: 'Light', icon: <Sun size={13} /> },
                      { id: 'dark', label: 'Dark', icon: <Moon size={13} /> },
                      { id: 'system', label: 'Auto', icon: <Monitor size={13} /> }
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={settings.theme === mode.id ? 'is-active' : ''}
                      onClick={() => void updateSettings({ theme: mode.id as ThemeMode })}
                    >
                      {mode.icon}
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="glass-popover-section">
                <span className="glass-popover-label">Liquid Glass Material</span>
                <div className="glass-popover-presets">
                  {PRESETS.map((preset) => {
                    const active = currentPreset === preset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`glass-popover-preset ${active ? 'is-active' : ''}`}
                        onClick={() => void updateSettings({ glassPreset: preset.id })}
                      >
                        <span
                          className="popover-swatch"
                          style={{ background: preset.swatch }}
                          aria-hidden="true"
                        />
                        <span>{preset.label}</span>
                        {active && <Check size={13} strokeWidth={3} />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="glass-popover-section">
                <span className="glass-popover-label">Frost Depth</span>
                <div className="glass-popover-modes">
                  {(
                    [
                      { id: 'subtle', label: 'Subtle' },
                      { id: 'balanced', label: 'Balanced' },
                      { id: 'ultra', label: 'Ultra' }
                    ] as const
                  ).map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      className={currentIntensity === level.id ? 'is-active' : ''}
                      onClick={() =>
                        void updateSettings({ glassIntensity: level.id as GlassIntensity })
                      }
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="glass-icon-button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light glass theme' : 'Switch to dark glass theme'}
          title={isDark ? 'Switch to light glass' : 'Switch to dark glass'}
        >
          {isDark ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
        </button>
        <button type="button" className="help-button" onClick={() => openModal('help')}>
          <HelpCircle size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>Need a hand?</span>
        </button>
      </div>
    </header>
  )
}
