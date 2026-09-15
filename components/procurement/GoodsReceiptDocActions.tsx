'use client'

import { useState } from 'react'
import { Download, Eye, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'

// Same pattern as PurchaseOrderDocActions.tsx: preview and download both come
// from the same server-rendered HTML (lib/pdf/goodsReceiptHtml.ts) - the
// preview asks for ?format=png, the download gets the PDF.
export default function GoodsReceiptDocActions({ receiptId, riNo }: { receiptId: string; riNo: string }) {
  const base = `/api/procurement/receipts/${receiptId}/pdf`
  const pngUrl = `${base}?format=png`

  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setIsPreviewOpen(true)}>
        <Eye className="h-3.5 w-3.5" /> ดูตัวอย่าง
      </Button>

      <a href={base} target="_blank" rel="noreferrer">
        <Button type="button" variant="secondary" size="sm">
          <Printer className="h-3.5 w-3.5" /> พิมพ์
        </Button>
      </a>

      <a href={`${base}?download=1`} download={`${riNo}.pdf`}>
        <Button type="button" variant="secondary" size="sm">
          <Download className="h-3.5 w-3.5" /> ดาวน์โหลด PDF
        </Button>
      </a>

      <Modal isOpen={isPreviewOpen} onClose={() => setIsPreviewOpen(false)} title={`ใบรับสินค้า ${riNo}`} panelClassName="max-w-3xl">
        <div className="space-y-4">
          <div className="max-h-[65vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pngUrl} alt={`ใบรับสินค้า ${riNo}`} className="mx-auto w-full rounded-lg bg-white shadow-sm" />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" onClick={() => setIsPreviewOpen(false)}>
              ปิด
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
