'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download, Eye, Loader2, Printer, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'

// Both the on-screen preview and the downloaded file come from the same
// server-rendered HTML (lib/pdf/purchaseOrderHtml.ts) - the preview asks for
// ?format=png, the download gets the PDF. That means what you copy into a
// chat with the supplier is pixel-identical to what you'd have sent as a PDF.
export default function PurchaseOrderDocActions({ orderId, poNo }: { orderId: string; poNo: string }) {
  const base = `/api/procurement/orders/${orderId}/pdf`
  const pngUrl = `${base}?format=png`

  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    // navigator.canShare with a dummy file is the only reliable way to know
    // whether file sharing (not just link sharing) is actually supported.
    try {
      const probe = new File([new Blob([''], { type: 'image/png' })], 'probe.png', { type: 'image/png' })
      setCanShare(typeof navigator.share === 'function' && navigator.canShare?.({ files: [probe] }) === true)
    } catch {
      setCanShare(false)
    }
  }, [])

  async function fetchPng(): Promise<Blob> {
    const response = await fetch(pngUrl)
    if (!response.ok) throw new Error('ไม่สามารถสร้างรูปใบสั่งซื้อได้')
    return response.blob()
  }

  async function handleCopy() {
    setCopyState('working')
    try {
      // Safari only honours a clipboard write if the ClipboardItem is
      // constructed with the pending promise rather than an awaited blob, so
      // prefer that shape and fall back for browsers that reject it.
      if (typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetchPng() })])
        } catch {
          const blob = await fetchPng()
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        }
      } else {
        throw new Error('เบราว์เซอร์นี้ไม่รองรับการคัดลอกรูป')
      }
      setCopyState('done')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 3000)
    }
  }

  async function handleShare() {
    try {
      const blob = await fetchPng()
      const file = new File([blob], `${poNo}.png`, { type: 'image/png' })
      await navigator.share({ files: [file], title: `ใบสั่งซื้อ ${poNo}` })
    } catch {
      /* user dismissed the share sheet, or sharing failed - nothing to report */
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setIsPreviewOpen(true)}>
        <Eye className="h-3.5 w-3.5" /> ดูตัวอย่าง
      </Button>

      <Button type="button" variant="secondary" size="sm" onClick={handleCopy} disabled={copyState === 'working'}>
        {copyState === 'working' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : copyState === 'done' ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copyState === 'done' ? 'คัดลอกแล้ว' : copyState === 'error' ? 'คัดลอกไม่สำเร็จ' : 'คัดลอกรูป'}
      </Button>

      {canShare && (
        <Button type="button" variant="secondary" size="sm" onClick={handleShare}>
          <Share2 className="h-3.5 w-3.5" /> แชร์
        </Button>
      )}

      <a href={base} target="_blank" rel="noreferrer">
        <Button type="button" variant="secondary" size="sm">
          <Printer className="h-3.5 w-3.5" /> พิมพ์
        </Button>
      </a>

      <a href={`${base}?download=1`} download={`${poNo}.pdf`}>
        <Button type="button" variant="secondary" size="sm">
          <Download className="h-3.5 w-3.5" /> ดาวน์โหลด PDF
        </Button>
      </a>

      <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title={`ใบสั่งซื้อ ${poNo}`} panelClassName="max-w-3xl">
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            กดปุ่ม &ldquo;คัดลอกรูป&rdquo; เพื่อคัดลอกไปวางในแชท หรือคลิกขวาที่รูปแล้วเลือก &ldquo;Copy image&rdquo;
          </p>
          <div className="max-h-[65vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pngUrl} alt={`ใบสั่งซื้อ ${poNo}`} className="mx-auto w-full rounded-lg bg-white shadow-sm" />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={handleCopy} disabled={copyState === 'working'}>
              {copyState === 'working' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              {copyState === 'done' ? 'คัดลอกแล้ว' : 'คัดลอกรูป'}
            </Button>
            <Button type="button" onClick={() => setIsPreviewOpen(false)}>
              ปิด
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
