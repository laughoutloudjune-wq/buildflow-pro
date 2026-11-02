'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Plus, Printer, Search } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import PurchaseRequestDetail from '@/components/procurement/PurchaseRequestDetail'
import { approvePurchaseRequest } from '@/actions/procurement-actions'
import { getBoqOverRequestIds } from '@/actions/procurement/boq-control'
import type { PurchaseRequest, PurchaseRequestItem } from '@/lib/types/procurement'
import { requestLineUnit } from '@/lib/procurement/requestQuantities'

type Tab = 'todo' | 'wait' | 'done' | 'all'

const TABS: { key: Tab; label: string }[] = [
  { key: 'todo', label: 'ต้องทำ' },
  { key: 'wait', label: 'รอของ' },
  { key: 'done', label: 'เสร็จ' },
  { key: 'all', label: 'ทั้งหมด' },
]

function inTab(r: PurchaseRequest, tab: Tab): boolean {
  if (tab === 'all') return true
  if (tab === 'todo') return r.status === 'pending_review' || r.status === 'approved'
  if (tab === 'wait') return r.status === 'ordered'
  return r.status === 'received'
}

function plotText(r: PurchaseRequest): string {
  if (r.plots?.name) return `แปลง ${r.plots.name}`
  if (r.plot_groups?.name) return `กลุ่ม ${r.plot_groups.name}`
  const names = (r.purchase_request_plots || []).map((p) => p.plots?.name).filter(Boolean)
  if (names.length > 0) return `แปลง ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`
  return ''
}

/** Late = still not delivered and the needed-by day has passed. */
function isLate(r: PurchaseRequest, today: number): boolean {
  if (!r.needed_by_date) return false
  if (r.status !== 'pending_review' && r.status !== 'approved' && r.status !== 'ordered') return false
  return new Date(r.needed_by_date).getTime() < today
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '–'

const pad = (n: number) => String(n).padStart(4, '0')

/** One word for where the request stands. For an approved request it says how
 * many lines still wait for an order. */
function statusOf(r: PurchaseRequest): { label: string; tone: string } {
  const items = r.purchase_request_items || []
  switch (r.status) {
    case 'pending_review':
      return { label: 'รออนุมัติ', tone: 'bg-amber-50 text-amber-800' }
    case 'approved': {
      const open = items.filter((i) => i.line_status === 'open').length
      if (open === 0) return { label: 'รอของ', tone: 'bg-slate-100 text-slate-700' }
      return { label: `รอสั่ง ${open} จาก ${items.length}`, tone: 'bg-indigo-50 text-indigo-700' }
    }
    case 'ordered':
      return { label: 'รอของ', tone: 'bg-slate-100 text-slate-700' }
    case 'received':
      return { label: 'ของมาครบ', tone: 'bg-emerald-50 text-emerald-700' }
    case 'rejected':
      return { label: 'ไม่อนุมัติ', tone: 'bg-rose-50 text-rose-700' }
    default:
      return { label: 'ยกเลิก', tone: 'bg-slate-100 text-slate-500' }
  }
}

function lineStatus(r: PurchaseRequest, item: PurchaseRequestItem): { label: string; tone: string } {
  if (r.status === 'pending_review') return { label: 'รออนุมัติ', tone: 'text-amber-700' }
  if (r.status === 'rejected') return { label: 'ไม่อนุมัติ', tone: 'text-rose-600' }
  if (r.status === 'cancelled') return { label: 'ยกเลิก', tone: 'text-slate-400' }
  switch (item.line_status) {
    case 'arrived':
      return { label: 'ของมาแล้ว', tone: 'text-emerald-700' }
    case 'ordered':
      return { label: 'สั่งแล้ว', tone: 'text-slate-500' }
    case 'closed':
      return { label: 'ปิดรายการ', tone: 'text-slate-400' }
    default:
      return { label: 'รอสั่ง', tone: 'text-amber-700' }
  }
}

export default function PurchaseRequestsPageClient({
  requests,
  initialError,
}: {
  requests: PurchaseRequest[]
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [today] = useState(() => new Date().setHours(0, 0, 0, 0))
  const [tab, setTab] = useState<Tab>('todo')
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  // The requests the popup walks through (the list as it was when it opened), so ‹ ใบก่อน / ใบถัดไป › stay put while statuses change.
  const [navIds, setNavIds] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [overIds, setOverIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Looked up from `requests` (not a filtered list) so an approve inside the
  // modal that moves the request to another tab doesn't yank the modal away.
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? null

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  // "เกิน BOQ" is only worth computing for requests that still need a person.
  const checkKey = requests
    .filter((r) => r.status === 'pending_review' || r.status === 'approved')
    .map((r) => r.id)
    .join(',')
  useEffect(() => {
    let cancelled = false
    const ids = checkKey ? checkKey.split(',') : []
    if (ids.length === 0) return
    getBoqOverRequestIds(ids)
      .then((over) => {
        if (!cancelled) setOverIds(new Set(over))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [checkKey])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return requests
    return requests.filter((r) => {
      const materials = (r.purchase_request_items || []).map((i) => i.material_types?.name || '').join(' ')
      const haystack = `${r.pr_no} ${r.projects?.name || ''} ${plotText(r)} ${materials}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [requests, search])

  const counts = useMemo(() => {
    const out: Record<Tab, number> = { todo: 0, wait: 0, done: 0, all: matches.length }
    for (const r of matches) {
      if (inTab(r, 'todo')) out.todo++
      else if (inTab(r, 'wait')) out.wait++
      else if (inTab(r, 'done')) out.done++
    }
    return out
  }, [matches])

  const rows = useMemo(() => {
    const list = matches.filter((r) => inTab(r, tab))
    if (tab === 'all' || tab === 'done') return list
    // Problems first (overdue, over BOQ), then the oldest waiting.
    const problems = (r: PurchaseRequest) => (isLate(r, today) ? 2 : 0) + (overIds.has(r.id) ? 1 : 0)
    return [...list].sort((a, b) => problems(b) - problems(a) || String(a.created_at).localeCompare(String(b.created_at)))
  }, [matches, tab, today, overIds])

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function approve(r: PurchaseRequest) {
    setBusyId(r.id)
    startTransition(async () => {
      const result = await approvePurchaseRequest(r.id)
      setBusyId(null)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('อนุมัติคำขอซื้อเรียบร้อยแล้ว')
      router.refresh()
    })
  }

  function approveAndOrder(r: PurchaseRequest) {
    setBusyId(r.id)
    startTransition(async () => {
      const result = await approvePurchaseRequest(r.id)
      if ('error' in result) {
        setBusyId(null)
        toast.error(result.error)
        return
      }
      router.push(`/dashboard/procurement/orders/create?fromRequest=${r.id}`)
    })
  }

  function renderActions(r: PurchaseRequest) {
    const busy = isPending && busyId === r.id
    if (r.status === 'pending_review') {
      return (
        <span className="flex flex-wrap justify-end gap-1.5">
          <Button type="button" size="sm" variant="secondary" onClick={() => approve(r)} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'อนุมัติ'}
          </Button>
          <Button type="button" size="sm" onClick={() => approveAndOrder(r)} disabled={busy}>
            อนุมัติ + ทำ PO
          </Button>
        </span>
      )
    }
    if (r.status === 'approved') {
      return (
        <Button type="button" size="sm" onClick={() => router.push(`/dashboard/procurement/orders/create?fromRequest=${r.id}`)}>
          ออกใบสั่งซื้อ
        </Button>
      )
    }
    return null
  }

  function openRequest(id: string) {
    setNavIds(rows.map((r) => r.id))
    setSelectedRequestId(id)
  }

  function renderCard(r: PurchaseRequest) {
    const status = statusOf(r)
    const late = isLate(r, today)
    const over = overIds.has(r.id)
    const items = r.purchase_request_items || []
    const shown = items.slice(0, 4)
    return (
      <li key={r.id}>
        <div
          className="grid cursor-pointer grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_auto]"
          onClick={() => openRequest(r.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openRequest(r.id)
            }
          }}
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={checked.has(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleOne(r.id)}
                  aria-label={`เลือก #${pad(r.pr_no)}`}
                />
              )}
              <span className="font-mono font-semibold text-indigo-600">#{pad(r.pr_no)}</span>
              <span className="font-medium text-slate-800">{plotText(r) || r.projects?.name || 'ไม่ระบุแปลง'}</span>
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
              {late && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">เลยวัน</span>}
              {over && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">เกิน BOQ</span>}
            </div>
            <p className="text-xs text-slate-500">
              {r.requester?.full_name || r.requester?.email || '-'} · {items.length} รายการ
              {r.needed_by_date ? (
                <>
                  {' · ต้องการ '}
                  <span className={late ? 'font-semibold text-rose-600' : ''}>{fmtDate(r.needed_by_date)}</span>
                </>
              ) : (
                ''
              )}
            </p>
          </div>
          <div className="flex items-start justify-end" onClick={(e) => e.stopPropagation()}>
            {renderActions(r)}
          </div>
          {items.length > 0 && (
            <div className="grid gap-x-8 gap-y-0.5 text-[13px] md:col-span-2 md:grid-cols-2">
              {shown.map((item) => {
                const s = lineStatus(r, item)
                return (
                  <div key={item.id} className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-slate-700">
                      {item.material_types?.name || '-'} · {Number(item.quantity_requested).toLocaleString('th-TH')} {requestLineUnit(item)}
                    </span>
                    <span className={`shrink-0 text-xs ${s.tone}`}>{s.label}</span>
                  </div>
                )
              })}
              {items.length > shown.length && <span className="text-xs text-slate-400">อีก {items.length - shown.length} รายการ</span>}
            </div>
          )}
        </div>
      </li>
    )
  }

  // Popup navigation: stays inside the list the popup was opened from.
  const navIndex = selectedRequestId ? navIds.indexOf(selectedRequestId) : -1
  function goTo(offset: number) {
    const target = navIds[navIndex + offset]
    if (target) setSelectedRequestId(target)
  }
  // After approving or rejecting: on to the next request, or close at the end of the list.
  function goNextOrClose() {
    const target = navIds[navIndex + 1]
    if (target) setSelectedRequestId(target)
    else setSelectedRequestId(null)
  }

  const printUrl = `/api/procurement/requests/pdf?ids=${Array.from(checked).join(',')}`

  return (
    <PageContainer width="wide">
      <PageHeader
        title="คำขอซื้อ (PR)"
        subtitle="หนึ่งใบหนึ่งแถว แตะแถวเพื่อดูรายการของ"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => router.push('/dashboard/procurement/requests/create')}>
              <Plus className="h-4 w-4" /> สร้างคำขอซื้อ
            </Button>
            <div className="relative" ref={menuRef}>
              <Button type="button" variant="secondary" onClick={() => setMenuOpen((v) => !v)} aria-label="เมนูเพิ่มเติม" aria-expanded={menuOpen}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setSelectMode((v) => !v)
                      setChecked(new Set())
                      setMenuOpen(false)
                    }}
                  >
                    <Printer className="h-4 w-4" /> {selectMode ? 'เลิกเลือกหลายใบ' : 'เลือกหลายใบเพื่อพิมพ์'}
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาเลขที่ / โครงการ / แปลง / วัสดุ"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <Link href="/dashboard/procurement/orders/combine" className="ml-auto text-sm font-medium text-indigo-600 hover:text-indigo-800">
          ออกใบสั่งซื้อแยกตามร้าน (รวมหลายคำขอ)
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="สถานะคำขอซื้อ">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key)
            }}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
              tab === t.key ? 'border-indigo-600 bg-indigo-600 font-medium text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
            {t.key !== 'all' && <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-indigo-100' : 'text-slate-400'}`}>{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {selectMode && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <span className="text-sm text-indigo-800">
            เลือกแล้ว <span className="font-semibold">{checked.size}</span> ใบ
          </span>
          {checked.size > 0 && (
            <a href={printUrl} target="_blank" rel="noreferrer">
              <Button type="button" size="sm" variant="secondary">
                <Printer className="h-3.5 w-3.5" /> พิมพ์ที่เลือก (รวมหลายใบต่อแผ่น)
              </Button>
            </a>
          )}
        </Card>
      )}

      {requests.length === 0 ? (
        <Card>
          <EmptyState variant="empty" title="ยังไม่มีคำขอซื้อ" description={'กด "สร้างคำขอซื้อ" เพื่อเริ่มต้น'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {search.trim() ? 'ไม่พบคำขอตามคำค้นหาในแท็บนี้' : 'ไม่มีคำขอในแท็บนี้'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">{rows.map(renderCard)}</ul>
          )}
        </Card>
      )}

      <Modal
        isOpen={selectedRequest != null}
        onClose={() => setSelectedRequestId(null)}
        title={selectedRequest ? `คำขอซื้อ #${pad(selectedRequest.pr_no)}` : undefined}
        panelClassName="max-w-6xl"
        footer={
          navIds.length > 1 && navIndex >= 0 ? (
            <div className="flex items-center justify-between gap-3 px-5 py-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => goTo(-1)} disabled={navIndex <= 0}>
                <ChevronLeft className="h-4 w-4" /> ใบก่อน
              </Button>
              <span className="text-xs text-slate-500">
                {navIndex + 1} / {navIds.length}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => goTo(1)} disabled={navIndex >= navIds.length - 1}>
                ใบถัดไป <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : undefined
        }
      >
        {selectedRequest && (
          <PurchaseRequestDetail
            key={selectedRequest.id}
            request={selectedRequest}
            onChanged={() => router.refresh()}
            onDecided={goNextOrClose}
          />
        )}
      </Modal>
    </PageContainer>
  )
}
