import { ArrowRight, Minus, Square, X } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'
import { deviceKindLabel, platformName } from '../lib/format'

export function TitleBar(): JSX.Element {
  const { platform, selectedPeer } = useBridge()
  const isMac = platform === 'darwin'
  const routeTarget = deviceKindLabel(selectedPeer?.platform ?? 'win32').replace('Windows PC', 'Windows')

  return (
    <div
      className="titlebar"
      onDoubleClick={() => {
        if (!isMac) window.saveBridge.windowToggleMaximize()
      }}
    >
      <div className="titlebar-drag" aria-hidden="true" />
      <div className="titlebar-center">Save bridge</div>
      <div className={`titlebar-route ${isMac ? '' : 'is-windows'}`}>
        <span>{platformName(platform)}</span>
        <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
        <span>{selectedPeer ? platformName(selectedPeer.platform) : routeTarget}</span>
      </div>
      {!isMac && (
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="Minimize"
            onClick={() => window.saveBridge.windowMinimize()}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label="Maximize"
            onClick={() => window.saveBridge.windowToggleMaximize()}
          >
            <Square size={11} />
          </button>
          <button
            type="button"
            className="window-control is-close"
            aria-label="Close"
            onClick={() => window.saveBridge.windowClose()}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
