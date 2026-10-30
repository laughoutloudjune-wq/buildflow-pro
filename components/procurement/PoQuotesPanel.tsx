'use client'

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, Scale, X } from 'lucide-react'
import { addPoQuote, choosePoQuote, getPoQuotes, removePoQuote, type PoQuote } from '@/actions/procurement/po-quotes'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Optional "เปรียบเทียบราคา" note: type up to 5 shops and their total price,
 * tick the one that was chosen. Informational - nothing else reads it. */
export default function PoQuotesPanel({ purchaseOrderId, canEdit }: { purchaseOrderId: string; canEdit: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [quotes, setQuotes] = useState<PoQuote[] | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [pending, startTransition] = useTransition()

  const reload = () => getPoQuotes(purchaseOrderId).then(setQuotes)

  useEffect(() => {
    getPoQuotes(purchaseOrderId).then(setQuotes)
  }, [purchaseOrderId])

  function run(fn: () => Promise<{ ok: true } | { error: string }>, done?: () => void) {
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) toast.error(res.error)
      else {
        done?.()
        await reload()
      }
    })
  }

  const list = quotes || []
  const lowest = list.length > 0 ? Math.min(...list.map((q) => q.total_price)) : 0
  // Nothing typed and nobody can type: keep the page uncluttered.
  if (quotes && list.length === 0 && !canEdit) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-700" aria-expanded={open}>
        <Scale className="h-4 w-4 text-slate-400" />
        เปรียบเทียบราคาร้าน <span className="text-xs font-normal text-slate-500">(ไม่บังคับ{list.length > 0 ? ` · ${list.length} ร้าน` : ''})</span>
        <ChevronDown className={cn('ml-auto h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-sm">
          {list.length === 0 && <p className="text-slate-500">ยังไม่ได้บันทึก - พิมพ์ชื่อร้านกับราคารวมที่เสนอมา เพื่อเก็บไว้ดูว่าทำไมเลือกร้านนี้</p>}
          {list.map((q) => (
            <div key={q.id} className="flex items-center gap-3">
              <input
                type="radio"
                name={`chosen-${purchaseOrderId}`}
                checked={q.is_chosen}
                readOnly
                disabled={!canEdit || pending}
                onClick={() => canEdit && run(() => choosePoQuote(purchaseOrderId, q.id))}
                aria-label={`เลือก ${q.supplier_name}`}
              />
              <span className="flex-1">{q.supplier_name}</span>
              <span className={cn('tabular-nums', q.total_price === lowest && list.length > 1 ? 'font-semibold text-emerald-700' : 'text-slate-700')}>฿{money(q.total_price)}</span>
              {canEdit && (
                <button type="button" aria-label="ลบ" disabled={pending} onClick={() => run(() => removePoQuote(purchaseOrderId, q.id))} className="rounded p-1 text-slate-300 hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {canEdit && list.length < 5 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อร้าน" className="min-w-40 flex-1 text-sm" />
              <input type="number" min="0" step="any" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="ราคารวม" className="w-32 text-right text-sm" />
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() =>
                  run(
                    () => addPoQuote(purchaseOrderId, { supplier_name: name, total_price: Number(price) || 0 }),
                    () => {
                      setName('')
                      setPrice('')
                    }
                  )
                }
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                เพิ่ม
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
