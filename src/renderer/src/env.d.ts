/// <reference types="vite/client" />

import type { JSX as ReactJSX } from 'react'
import type { SaveBridgeApi } from '@shared/types'

declare global {
  namespace JSX {
    interface Element extends ReactJSX.Element {}
    interface ElementClass extends ReactJSX.ElementClass {}
    interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }

  interface Window {
    saveBridge: SaveBridgeApi
  }
}

export {}
