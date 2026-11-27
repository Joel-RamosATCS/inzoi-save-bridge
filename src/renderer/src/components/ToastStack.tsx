import { AlertCircle, Check, Info, X } from 'lucide-react'
import { useBridge } from '../state/BridgeProvider'

export function ToastStack(): JSX.Element {
  const { toasts, dismissToast } = useBridge()

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast is-${toast.tone}`}>
          <span className="toast-icon">
            {toast.tone === 'error' ? (
              <AlertCircle size={17} />
            ) : toast.tone === 'success' ? (
              <Check size={17} strokeWidth={3} />
            ) : (
              <Info size={17} />
            )}
          </span>
          <div>
            <strong>{toast.title}</strong>
            {toast.message && <p>{toast.message}</p>}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
