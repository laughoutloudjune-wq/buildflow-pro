'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * useState for a list filter / search / sort / page that is mirrored into the
 * URL query string (history.replaceState, so no new history entry and no
 * re-render cost). When the user opens a row and comes back with BackButton or
 * the browser's back, the list remounts, reads the same URL and shows the
 * same filters again.
 *
 *   const [search, setSearch] = useUrlState('q', '')
 *   const [page, setPage] = useUrlNumber('page', 1)
 *   const [onlyOpen, setOnlyOpen] = useUrlFlag('open')
 *
 * A value equal to its default is removed from the URL to keep it clean.
 */
/** Remember the list's current query string so pages that send the user back to
 * the list after an action (approve, delete...) can restore its filters. */
function saveListSearch() {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('listSearch:' + window.location.pathname, window.location.search)
  } catch {}
}

function writeParam(key: string, value: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (value === null || value === '') url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  const next = `${url.pathname}${url.search}${url.hash}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== current) window.history.replaceState(window.history.state, '', next)
  saveListSearch()
}

export function useUrlState<T extends string = string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
): [T, (next: T | ((prev: T) => T)) => void] {
  const params = useSearchParams()
  useEffect(saveListSearch, [])
  const [value, setValue] = useState<T>(() => {
    const raw = params.get(key)
    if (raw === null) return defaultValue
    if (allowed && !allowed.includes(raw as T)) return defaultValue
    return raw as T
  })
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        // Side effect outside render path is fine: replaceState is idempotent.
        queueMicrotask(() => writeParam(key, resolved === defaultValue ? null : resolved))
        return resolved
      })
    },
    [key, defaultValue],
  )
  return [value, set]
}

export function useUrlNumber(key: string, defaultValue: number): [number, (next: number | ((prev: number) => number)) => void] {
  const [raw, setRaw] = useUrlState<string>(key, String(defaultValue))
  const n = Number(raw)
  const value = Number.isFinite(n) ? n : defaultValue
  const set = useCallback(
    (next: number | ((prev: number) => number)) => {
      setRaw((prev) => {
        const p = Number(prev)
        const resolved = typeof next === 'function' ? next(Number.isFinite(p) ? p : defaultValue) : next
        return String(resolved)
      })
    },
    [setRaw, defaultValue],
  )
  return [value, set]
}

export function useUrlFlag(key: string, defaultValue = false): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [raw, setRaw] = useUrlState<string>(key, defaultValue ? '1' : '0')
  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setRaw((prev) => {
        const resolved = typeof next === 'function' ? next(prev === '1') : next
        return resolved ? '1' : '0'
      })
    },
    [setRaw],
  )
  return [raw === '1', set]
}

/**
 * Same idea for a filter object (`{ projectId?, status?, ... }`). Pass the list
 * of its keys; each becomes a query parameter (optionally prefixed). Keys that
 * are undefined / empty are left out of the URL.
 */
export function useUrlObject<T extends Record<string, string | undefined>>(
  keys: readonly (keyof T & string)[],
  prefix = '',
): [T, (next: T | ((prev: T) => T)) => void] {
  const params = useSearchParams()
  useEffect(saveListSearch, [])
  const [value, setValue] = useState<T>(() => {
    const out: Record<string, string | undefined> = {}
    for (const k of keys) {
      const raw = params.get(prefix + k)
      if (raw !== null && raw !== '') out[k] = raw
    }
    return out as T
  })
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        queueMicrotask(() => {
          for (const k of keys) writeParam(prefix + k, resolved[k] || null)
        })
        return resolved
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefix],
  )
  return [value, set]
}

/**
 * Like useEffect, but not on the first render. Use it for "reset to page 1
 * when a filter changes" so a page number restored from the URL (after Back)
 * is not thrown away on mount.
 */
export function useSkipFirstEffect(effect: () => void, deps: React.DependencyList) {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    effect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** String-typed convenience (avoids literal-type inference from the default). */
export function useUrlString(key: string, defaultValue = ''): [string, (next: string | ((prev: string) => string)) => void] {
  return useUrlState<string>(key, defaultValue)
}

/**
 * URL of a list page with the filters the user last had on it, plus extra
 * params (e.g. a success message). Use it when an action sends the user back
 * to a list, so the list does not come back reset.
 */
export function listUrlWithSavedFilters(path: string, extra: Record<string, string> = {}): string {
  let saved = ''
  try {
    saved = sessionStorage.getItem('listSearch:' + path) ?? ''
  } catch {}
  const params = new URLSearchParams(saved)
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}
