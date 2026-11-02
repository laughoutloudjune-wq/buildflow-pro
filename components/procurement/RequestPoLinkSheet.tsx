'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  getOrderLinkCandidates,
  getRequestLinkCandidates,
  linkRequestLinesToOrder,
} from '@/actions/procurement/request-links'
import { orderMatchCount, suggestPairs, type LinkLine, type LinkOrder, type LinkPoItem, type PairTag } from '@/lib/procurement/linkPairing'

type Props =
  | {
      mode: 'request'
      requestId: string
      /** Only this line (the line's own "ผูก PO" link). */
      onlyLineId?: string
      /** Go straight to this order when it is in the list (a line closed with a typed PO number). */
      initialPoNo?: string | null
      onClose: () => void
      onLinked: () => void
    }
  | { mode: 'order'; orderId: string; onClose: () => void; onLinked: () => void }

const NONE = ''

/** Link request lines to order lines, from either side. Lines are paired for
 * you (same material first, then a similar name); change any pair or leave it
 * unlinked, then press ผูก. */
export default function RequestPoLinkSheet(props: Props) {
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lines, setLines] = useState<LinkLine[]>([])
  const [orders, setOrders] = useState<LinkOrder[]>([])
  const [orderId, setOrderId] = useState<string | null>(props.mode === 'order' ? props.orderId : null)
  const [search, setSearch] = useState('')
  // request mode: request line id -> order item id. order mode: order item id -> request line id.
  const [picks, setPicks] = useState<Record<string, string>>({})

  const key = props.mode === 'request' ? `r:${props.requestId}` : `o:${props.orderId}`
  const onlyLineId = props.mode === 'request' ? props.onlyLineId : undefined
  const initialPoNo = props.mode === 'request' ? props.initialPoNo : null

  useEffect(() => {
    let cancelled = false
    async function load() {
      const result =
        props.mode === 'request' ? await getRequestLinkCandidates(props.requestId) : await getOrderLinkCandidates(props.orderId)
      if (cancelled) return
      if ('error' in result) {
        setLoadError(result.error)
      } else if ('orders' in result) {
        const wanted = onlyLineId ? result.lines.filter((l) => l.id === onlyLineId) : result.lines
        setLines(wanted)
        setOrders(result.orders)
        const typed = initialPoNo ? result.orders.find((o) => o.poNo === initialPoNo) : null
        if (typed) setOrderId(typed.id)
      } else {
        setLines(result.lines)
        setOrders([result.order])
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [key, onlyLineId, initialPoNo])

  const order = orders.find((o) => o.id === orderId) ?? null

  // Pair the lines with the chosen order once it is picked.
  const suggestions = useMemo(() => {
    if (!order) return {} as Record<string, { targetId: string; tag: PairTag }>
    return props.mode === 'request' ? suggestPairs(lines, order.items) : suggestPairs(order.items, lines)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, lines, props.mode])

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const [source, s] of Object.entries(suggestions)) next[source] = s.targetId
      setPicks(next)
  }, [suggestions])

  const rankedOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders
      .filter((o) => !q || o.poNo.toLowerCase().includes(q) || (o.supplier || '').toLowerCase().includes(q))
      .map((o) => ({ order: o, matches: orderMatchCount(lines, o) }))
      .sort((a, b) => b.matches - a.matches)
  }, [orders, lines, search])

  const chosenCount = Object.values(picks).filter(Boolean).length

  function submit() {
    if (!order) return
    const links =
      props.mode === 'request'
        ? Object.entries(picks)
            .filter(([, itemId]) => itemId)
            .map(([lineId, itemId]) => ({ purchaseRequestItemId: lineId, purchaseOrderItemId: itemId }))
        : Object.entries(picks)
            .filter(([, lineId]) => lineId)
            .map(([itemId, lineId]) => ({ purchaseRequestItemId: lineId, purchaseOrderItemId: itemId }))
    if (links.length === 0) return
    startTransition(async () => {
      const result = await linkRequestLinesToOrder(links, {
        requestId: props.mode === 'request' ? props.requestId : undefined,
        orderId: order.id,
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success(`ผูกกับ ${order.poNo} แล้ว ${result.linked} รายการ`)
      props.onLinked()
    })
  }

  const title = props.mode === 'request' ? 'ผูกกับ PO ที่มีอยู่' : 'ผูกกับคำขอซื้อ'

  return (
    <Modal isOpen onClose={props.onClose} title={title} panelClassName="max-w-2xl">
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> กำลังโหลด...
          </div>
        ) : loadError ? (
          <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{loadError}</p>
        ) : lines.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
            {props.mode === 'request' ? 'ไม่มีรายการในคำขอนี้ที่รอผูกกับใบสั่งซื้อ' : 'ไม่มีรายการคำขอซื้อที่ยังรอสั่งในโครงการนี้'}
          </p>
        ) : !order ? (
          <>
            <p className="text-xs text-slate-500">
              ใบสั่งซื้อของโครงการนี้ เรียงตามที่ตรงกับรายการที่ยังค้างมากสุด
            </p>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นเลข PO หรือชื่อร้าน"
              className="w-full"
            />
            <div className="space-y-2">
              {rankedOrders.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">ไม่พบใบสั่งซื้อ</p>
              ) : (
                rankedOrders.slice(0, 40).map(({ order: o, matches }) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOrderId(o.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-indigo-400"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-medium text-slate-800">{o.poNo}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {o.supplier || '-'}
                        {o.orderDate ? ` · ${new Date(o.orderDate).toLocaleDateString('th-TH')}` : ''}
                      </span>
                    </span>
                    {matches > 0 && (
                      <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                        ตรง {matches} จาก {lines.length} ที่ค้าง
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              {props.mode === 'request' && (
                <button type="button" onClick={() => setOrderId(null)} className="text-indigo-600 hover:underline">
                  ‹ เลือก PO อื่น
                </button>
              )}
              <span className="font-mono font-medium text-slate-800">{order.poNo}</span>
              <span className="text-slate-500">{order.supplier || ''}</span>
            </div>
            <p className="text-xs text-slate-500">ระบบจับคู่ให้แล้ว เปลี่ยนได้ ถ้าไม่ใช่ให้เลือก &ldquo;ไม่ผูก&rdquo;</p>

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {props.mode === 'request'
                ? lines.map((line) => {
                    const pickedId = picks[line.id] ?? NONE
                    const target = order.items.find((i) => i.id === pickedId) ?? null
                    return (
                      <PairRow
                        key={line.id}
                        label={line.name}
                        detail={`ขอ ${line.quantity.toLocaleString('th-TH')} ${line.unit}`}
                        note={line.typedPoRef ? `เลขที่พิมพ์ไว้: ${line.typedPoRef}` : null}
                        value={pickedId}
                        onChange={(v) => setPicks((p) => ({ ...p, [line.id]: v }))}
                        options={order.items.map((i) => ({
                          id: i.id,
                          label: `${i.name} · ${i.quantity.toLocaleString('th-TH')} ${i.unit}`,
                        }))}
                        tag={pickedId ? tagFor(line, target) : null}
                        unitNote={target && target.unit !== line.unit ? `หน่วยต่าง: ${target.unit} / ${line.unit}` : null}
                      />
                    )
                  })
                : order.items.map((item) => {
                    const pickedId = picks[item.id] ?? NONE
                    const target = lines.find((l) => l.id === pickedId) ?? null
                    return (
                      <PairRow
                        key={item.id}
                        label={item.name}
                        detail={`สั่ง ${item.quantity.toLocaleString('th-TH')} ${item.unit}`}
                        note={null}
                        value={pickedId}
                        onChange={(v) => setPicks((p) => ({ ...p, [item.id]: v }))}
                        options={lines.map((l) => ({
                          id: l.id,
                          label: `${l.prNo ? `${l.prNo} · ` : ''}${l.name} · ${l.quantity.toLocaleString('th-TH')} ${l.unit}`,
                        }))}
                        tag={pickedId ? tagFor(target, item) : null}
                        unitNote={target && target.unit !== item.unit ? `หน่วยต่าง: ${item.unit} / ${target.unit}` : null}
                      />
                    )
                  })}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">สถานะคำขอจะเปลี่ยนเองตาม PO ที่ผูก</span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={props.onClose} disabled={isPending}>
                  ยกเลิก
                </Button>
                <Button type="button" onClick={submit} disabled={chosenCount === 0 || isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `ผูก ${chosenCount} รายการ`}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** 'ต่างยี่ห้อ' when the two lines are different materials. */
function tagFor(
  line: { materialTypeId: number } | null,
  item: Pick<LinkPoItem, 'materialTypeId'> | null
): string | null {
  if (!line || !item) return null
  return line.materialTypeId === item.materialTypeId ? null : 'ต่างยี่ห้อ'
}

function PairRow({
  label,
  detail,
  note,
  value,
  onChange,
  options,
  tag,
  unitNote,
}: {
  label: string
  detail: string
  note: string | null
  value: string
  onChange: (v: string) => void
  options: { id: string; label: string }[]
  tag: string | null
  unitNote: string | null
}) {
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{detail}</p>
        {note && <p className="text-xs text-amber-700">{note}</p>}
      </div>
      <div className="min-w-0 space-y-1">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full text-sm">
          <option value={NONE}>ไม่ผูก</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {(tag || unitNote) && (
          <p className="flex flex-wrap items-center gap-2 text-xs">
            {tag && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">{tag}</span>}
            {unitNote && <span className="text-slate-500">{unitNote}</span>}
          </p>
        )}
      </div>
    </div>
  )
}
