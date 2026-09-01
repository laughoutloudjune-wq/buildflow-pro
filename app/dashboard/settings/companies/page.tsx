'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { createCompany, deactivateCompany, getCompanies, updateCompany, uploadCompanyAsset } from '@/actions/procurement-actions'
import type { Company } from '@/lib/types/procurement'

const emptyDraft = { name: '', tax_id: '', address: '', phone: '', logo_url: '', signature_url: '' }

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const toast = useToast()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Company | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [uploading, setUploading] = useState<'logo' | 'signature' | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      setCompanies(await getCompanies(false))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลบริษัทไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }

  function openCreateModal() {
    setEditing(null)
    setDraft(emptyDraft)
    setIsModalOpen(true)
  }

  function openEditModal(company: Company) {
    setEditing(company)
    setDraft({
      name: company.name,
      tax_id: company.tax_id || '',
      address: company.address || '',
      phone: company.phone || '',
      logo_url: company.logo_url || '',
      signature_url: company.signature_url || '',
    })
    setIsModalOpen(true)
  }

  // Uploads immediately and stores the returned URL on the draft, so the
  // company row itself only ever holds a plain URL string.
  async function handleAssetUpload(kind: 'logo' | 'signature', file: File | undefined) {
    if (!file) return
    setUploading(kind)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const url = await uploadCompanyAsset(kind, formData)
      setDraft((prev) => ({ ...prev, [kind === 'logo' ? 'logo_url' : 'signature_url']: url }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'อัปโหลดไม่สำเร็จ')
    } finally {
      setUploading(null)
    }
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditing(null)
  }

  function handleSubmit() {
    if (!draft.name.trim()) {
      toast.error('กรุณาใส่ชื่อบริษัท')
      return
    }
    startTransition(async () => {
      try {
        if (editing) {
          await updateCompany(editing.id, draft)
        } else {
          await createCompany(draft)
        }
        closeModal()
        await load()
        toast.success('บันทึกข้อมูลบริษัทเรียบร้อยแล้ว')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  function handleDeactivate(company: Company) {
    if (!confirm(`ยืนยันปิดใช้งานบริษัท "${company.name}"?`)) return
    startTransition(async () => {
      try {
        await deactivateCompany(company.id)
        await load()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ปิดใช้งานไม่สำเร็จ')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลบริษัท...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/dashboard/settings"
          className="mb-2 flex w-fit items-center gap-1 text-sm text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" /> กลับไปตั้งค่า
        </Link>
        <PageHeader
          title="บริษัทในเครือ (Companies)"
          subtitle="รายชื่อนิติบุคคลในเครือที่ใช้เลือกเป็นผู้ซื้อเวลาสร้างใบสั่งซื้อ"
          actions={
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4" />
              เพิ่มบริษัทใหม่
            </Button>
          }
        />
      </div>


      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">ชื่อบริษัท</th>
                <th className="px-4 py-3 font-semibold">เลขผู้เสียภาษี</th>
                <th className="px-4 py-3 font-semibold">โทรศัพท์</th>
                <th className="px-4 py-3 font-semibold">สถานะ</th>
                <th className="px-4 py-3 w-[80px] text-center font-semibold">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {companies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center italic text-slate-400">
                    ยังไม่มีบริษัทในระบบ กดปุ่ม &quot;เพิ่มบริษัทใหม่&quot; เพื่อเริ่มต้น
                  </td>
                </tr>
              ) : (
                companies.map((company) => (
                  <tr key={company.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{company.name}</td>
                    <td className="px-4 py-3 text-slate-500">{company.tax_id || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{company.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          company.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {company.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openEditModal(company)}
                        disabled={isPending}
                        className="rounded p-1 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                        title="แก้ไข"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {company.is_active && (
                        <button
                          onClick={() => handleDeactivate(company)}
                          disabled={isPending}
                          className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                          title="ปิดใช้งาน"
                        >
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editing ? 'แก้ไขบริษัท' : 'เพิ่มบริษัทใหม่'}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อบริษัท</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full"
              placeholder="เช่น บริษัท เอบีซี ก่อสร้าง จำกัด"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลขผู้เสียภาษี</label>
              <input value={draft.tax_id} onChange={(e) => setDraft({ ...draft, tax_id: e.target.value })} className="w-full" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">โทรศัพท์</label>
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="w-full" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ที่อยู่</label>
            <textarea value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="w-full" rows={2} />
          </div>

          {/* Logo and signature are per-company: a PO issued in this
              company's name prints these, not the organization-wide ones. */}
          <div className="grid grid-cols-2 gap-4">
            {(['logo', 'signature'] as const).map((kind) => {
              const url = kind === 'logo' ? draft.logo_url : draft.signature_url
              const label = kind === 'logo' ? 'โลโก้บริษัท' : 'ลายเซ็นผู้อนุมัติ'
              return (
                <div key={kind}>
                  <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
                  <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-2">
                    {uploading === kind ? (
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                    ) : url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-xs text-slate-400">ยังไม่ได้อัปโหลด</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleAssetUpload(kind, e.target.files?.[0])}
                      disabled={uploading !== null}
                      className="w-full text-xs"
                    />
                    {url && (
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, [kind === 'logo' ? 'logo_url' : 'signature_url']: '' })}
                        className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                      >
                        ลบ
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={closeModal}>
              ยกเลิก
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'บันทึก'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
