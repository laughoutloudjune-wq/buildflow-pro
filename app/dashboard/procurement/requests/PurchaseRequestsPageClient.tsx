'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, MoreHorizontal, Plus, Printer, Search } from 'lucide-react'
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
import type { PurchaseRequest } from '@/lib/types/procurement'
import { compareRequestLine } from '@/lib/procurement/requestFlags'
import { requestLineUnit } from '@/lib/procurement/requestQuantities'

type Pile = 'approve' | 'order' | 'done' | 'rejected'

function pileOf(r: PurchaseRequest): Pile {
  if (r.status === 'pending_review') return 'approve'
  if (r.status === 'approved') return 'order'
  if (r.status === 'rejected') return 'rejected'
  return 'done'
}

const PILES: { key: Exclude<Pile, 'done' | 'rejected'>; title: string; hint: string; button: string }[] = [
  { key: 'approve', title: 'รออนุมัติ', hint: 'ขอเข้ามาแล้ว รอตัดสินใจ', button: 'อนุมัติ' },
  { key: 'order', title: 'รอออกใบสั่งซื้อ', hint: 'อนุมัติแล้ว ยังไม่ได้สั่ง', button: 'ออกใบสั่งซื้อ' },
]

const TRACK = ['ขอ', 'อนุมัติ', 'สั่ง', 'ของมา']

function trackStep(r: PurchaseRequest): number {
  if (r.status === 'received') return 4
  if (r.status === 'ordered') return 3
  if (r.status === 'approved') return 2
  return 1
}

function plotText(r: PurchaseRequest): string {
  if (r.plots?.name) return `แปลง ${r.plots.name}`
  if (r.plot_groups?.name) return `กลุ่ม ${r.plot_groups.name}`
  const names = (r.purchase_request_plots || []).map((p) => p.plots?.name).filter(Boolean)
  if (names.length > 0) return `แปลง ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`
  return ''
}

function materialSummary(r: PurchaseRequest): string {
  const items = r.purchase_request_items || []
  if (items.length === 0) return '-'
  const first = items[0].material_types?.name || '-'
  return items.length > 1 ? `${first} +${items.length - 1}` : first
}

type Chip = { label: string; tone: string }

function chipsOf(r: PurchaseRequest, now: number, overBoq: boolean): Chip[] {
  const chips: Chip[] = []
  if (overBoq) chips.push({ label: 'เกิน BOQ', tone: 'bg-amber-50 text-amber-800' })
  const lines = (r.purchase_request_items || []).map((item) => compareRequestLine(r, item, now))
  if (lines.some((l) => l.late)) chips.push({ label: 'เลยวันที่ต้องการ', tone: 'bg-rose-50 text-rose-700' })
  if (lines.some((l) => l.substituted)) chips.push({ label: 'ซื้อตัวอื่นแทน', tone: 'bg-indigo-50 text-indigo-700' })
  if ((r.purchase_request_items || []).some((i) => i.material_types?.unit && requestLineUnit(i) !== i.material_types.unit)) {
    chips.push({ label: 'ขอเป็นหน่วยอื่น', tone: 'bg-slate-100 text-slate-700' })
  }
  return chips
}

function Track({ step, rejected }: { step: number; rejected: boolean }) {
  if (rejected) return <span className="text-xs font-medium text-rose-600">ไม่อนุมัติ</span>
  return (
    <span className="flex items-center gap-1 text-[11px]" aria-label={`ความคืบหน้า ${TRACK[step - 1]}`}>
      {TRACK.map((label, i) => (
        <span key={label} className="flex items-center gap-1">
          <span className={i < step ? 'font-medium text-emerald-700' : 'text-slate-400'}>
            {i < step ? '●' : '○'} {label}
          </span>
          {i < TRACK.length - 1 && <span className="text-slate-300">→</span>}
        </span>
      ))}
    </span>
  )
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
  const [now] = useState(() => Date.now())
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showRejected, setShowRejected] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [overIds, setOverIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Looked up from `requests` (not a filtered list) so an approve inside the
  // modal that moves the request to another pile doesn't yank the modal away.
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? null

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  // "เกิน BOQ" is only worth computing for requests that still need a person.
  const checkKey = requests
    .filter((r) => pileOf(r) === 'approve' || pileOf(r) === 'order')
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

  const byPile = useMemo(() => {
    const out: Record<Pile, PurchaseRequest[]> = { approve: [], order: [], done: [], rejected: [] }
    for (const r of matches) out[pileOf(r)].push(r)
    // Problem requests first, then the oldest waiting.
    const problems = (r: PurchaseRequest) => (overIds.has(r.id) ? 1 : 0) + chipsOf(r, now, false).filter((c) => c.label === 'เลยวันที่ต้องการ').length
    for (const key of ['approve', 'order'] as const) {
      out[key].sort((a, b) => problems(b) - problems(a) || String(a.created_at).localeCompare(String(b.created_at)))
    }
    return out
  }, [matches, overIds, now])

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

  function act(pile: Pile, r: PurchaseRequest) {
    if (pile === 'approve') approve(r)
    else if (pile === 'order') router.push(`/dashboard/procurement/orders/create?fromRequest=${r.id}`)
  }

  function renderCard(r: PurchaseRequest, pile: Pile, button?: string) {
    const chips = chipsOf(r, now, overIds.has(r.id))
    const days = Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000)
    return (
      <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        {selectMode && <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`เลือก #${r.pr_no}`} />}
        <button type="button" onClick={() => setSelectedRequestId(r.id)} className="min-w-0 flex-1 space-y-1 text-left">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-mono font-medium text-indigo-600">#{String(r.pr_no).padStart(4, '0')}</span>
            <span className="font-medium text-slate-800">{materialSummary(r)}</span>
            <span className="text-slate-500">
              {r.projects?.name || '-'}
              {plotText(r) ? ` · ${plotText(r)}` : ''}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Track step={trackStep(r)} rejected={r.status === 'rejected'} />
            {chips.map((c) => (
              <span key={c.label} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.tone}`}>
                {c.label}
              </span>
            ))}
          </span>
          <span className="block text-xs text-slate-500">
            {r.requester?.full_name || r.requester?.email || '-'} · ขอเมื่อ {new Date(r.created_at).toLocaleDateString('th-TH')}
            {pile === 'approve' && days > 0 ? ` · รอมา ${days} วัน` : ''}
            {r.needed_by_date ? ` · ต้องการ ${new Date(r.needed_by_date).toLocaleDateString('th-TH')}` : ''}
          </span>
        </button>
        {pile === 'approve' && (
          <Button type="button" size="sm" variant="secondary" onClick={() => approveAndOrder(r)} disabled={isPending && busyId === r.id}>
            อนุมัติ + ทำ PO
          </Button>
        )}
        {button && (
          <Button type="button" size="sm" onClick={() => act(pile, r)} disabled={isPending && busyId === r.id}>
            {isPending && busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : button}
          </Button>
        )}
      </li>
    )
  }

  const open = byPile.approve.length + byPile.order.length
  const printUrl = `/api/procurement/requests/pdf?ids=${Array.from(checked).join(',')}`

  return (
    <PageContainer width="wide">
      <PageHeader
        title="คำขอซื้อ (PR)"
        subtitle="คำขอที่ต้องมีคนทำต่อ แยกเป็น 2 กอง กองละ 1 ปุ่ม"
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

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่ / โครงการ / แปลง / วัสดุ"
          className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
        />
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
        <>
          {open === 0 && (
            <Card className="flex items-center gap-2 p-4 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {search.trim() ? 'ไม่พบคำขอที่ต้องทำต่อตามคำค้นหา' : 'ไม่มีคำขอค้างอยู่ ทุกใบจัดการแล้ว'}
            </Card>
          )}
          {PILES.map((pile) => {
            const list = byPile[pile.key]
            if (list.length === 0) return null
            return (
              <section key={pile.key} className="space-y-1.5">
                <h2 className="flex items-baseline gap-2 px-1 text-sm font-semibold text-slate-800">
                  {pile.title} <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{list.length}</span>
                  <span className="text-xs font-normal text-slate-500">{pile.hint}</span>
                </h2>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-slate-100">{list.map((r) => renderCard(r, pile.key, pile.button))}</ul>
                </Card>
              </section>
            )
          })}

          {byPile.done.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1.5 px-1 text-sm font-medium text-slate-600" aria-expanded={showDone}>
                {showDone ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} เสร็จแล้ว ({byPile.done.length})
              </button>
              {showDone && (
                <Card className="mt-1.5 overflow-hidden">
                  <ul className="divide-y divide-slate-100">{byPile.done.map((r) => renderCard(r, 'done'))}</ul>
                </Card>
              )}
            </section>
          )}
          {byPile.rejected.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowRejected((v) => !v)} className="flex items-center gap-1.5 px-1 text-sm font-medium text-slate-600" aria-expanded={showRejected}>
                {showRejected ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} ไม่อนุมัติ ({byPile.rejected.length})
              </button>
              {showRejected && (
                <Card className="mt-1.5 overflow-hidden">
                  <ul className="divide-y divide-slate-100">{byPile.rejected.map((r) => renderCard(r, 'rejected'))}</ul>
                </Card>
              )}
            </section>
          )}
        </>
      )}

      <Modal
        isOpen={selectedRequest != null}
        onClose={() => setSelectedRequestId(null)}
        title={selectedRequest ? `คำขอซื้อ #${String(selectedRequest.pr_no).padStart(4, '0')}` : undefined}
        panelClassName="max-w-6xl"
      >
        {selectedRequest && <PurchaseRequestDetail request={selectedRequest} onChanged={() => router.refresh()} />}
      </Modal>
    </PageContainer>
  )
}
