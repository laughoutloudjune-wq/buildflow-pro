'use client'

import { useSyncExternalStore } from 'react'

const subscribeNever = () => () => {}

/**
 * True when this page runs inside a hub popup (components/construction/
 * EmbeddedFrameModal). The dashboard shell and the foreman tab bar hide
 * themselves there, so only the form itself shows. False on the server and on
 * the first client render, so hydration matches.
 */
export function useInFrame() {
  return useSyncExternalStore(
    subscribeNever,
    () => {
      try {
        return window.self !== window.top
      } catch {
        return true
      }
    },
    () => false
  )
}
