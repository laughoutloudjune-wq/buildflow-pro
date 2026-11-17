'use client'

import { useState } from 'react'
import { Camera, ImageOff, Loader2 } from 'lucide-react'
import { removeMaterialImage, uploadMaterialImage } from '@/actions/material-actions'
import { useToast } from '@/components/ui/Toast'
import { materialPhotoForm } from '@/lib/images/shrinkImage'

/** Photo box in the material edit window (Settings > วัสดุ). Uploads right
 * away, separate from the form's บันทึก, like the photo in the shop picker. */
export default function MaterialPhotoField({
  materialId,
  url,
  onChange,
}: {
  /** Null while creating: a photo can be added once the material is saved. */
  materialId: number | null
  url: string | null
  onChange: (url: string | null) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    if (materialId == null) return
    setBusy(true)
    try {
      const res = await uploadMaterialImage(materialId, await materialPhotoForm(file))
      if ('error' in res) toast.error(res.error)
      else {
        onChange(res.url)
        toast.success('บันทึกรูปแล้ว')
      }
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (materialId == null) return
    setBusy(true)
    try {
      const res = await removeMaterialImage(materialId)
      if ('error' in res) toast.error(res.error)
      else onChange(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">รูปวัสดุ</label>
      {materialId == null ? (
        <p className="text-xs text-slate-500">บันทึกวัสดุก่อน แล้วกด &quot;แก้ไข&quot; เพื่อเพิ่มรูป</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-300">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- public storage photo
              <img src={url} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageOff className="h-6 w-6" aria-hidden />
            )}
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:border-indigo-400 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {url ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void upload(file)
                }}
              />
            </label>
            {url && (
              <button type="button" onClick={() => void remove()} disabled={busy} className="text-xs text-slate-500 underline">
                เอารูปออก
              </button>
            )}
            <p className="text-xs text-slate-500">ถ่ายจากมือถือหรือเลือกไฟล์ ระบบย่อรูปให้อัตโนมัติ</p>
          </div>
        </div>
      )}
    </div>
  )
}
