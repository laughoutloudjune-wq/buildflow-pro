'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { SupplierInput } from '@/lib/types/procurement'

const fieldLabel = 'mb-1 block text-[13px] font-medium text-slate-600'

const PAYMENT_TERM_PRESETS = ['เงินสด (COD)', 'เครดิต 7 วัน', 'เครดิต 15 วัน', 'เครดิต 30 วัน', 'เครดิต 45 วัน', 'เครดิต 60 วัน']
const CUSTOM_TERM = 'อื่นๆ...'

export default function SupplierFormFields({
  value,
  onChange,
}: {
  value: SupplierInput
  onChange: (patch: Partial<SupplierInput>) => void
}) {
  const [showContact, setShowContact] = useState(
    Boolean(value.contact_name || value.email || value.phone)
  )
  const isPresetTerm = !value.payment_terms || PAYMENT_TERM_PRESETS.includes(value.payment_terms)

  return (
    <div className="space-y-4">
      <div>
        <label className={fieldLabel}>ประเภทซัพพลายเออร์</label>
        <div className="flex gap-5 pt-0.5 text-sm text-slate-700">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={(value.supplier_type ?? 'company') === 'company'}
              onChange={() => onChange({ supplier_type: 'company' })}
            />
            บริษัท / ห้างร้าน
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={value.supplier_type === 'individual'}
              onChange={() => onChange({ supplier_type: 'individual' })}
            />
            บุคคลทั่วไป
          </label>
        </div>
      </div>

      <div>
        <label className={fieldLabel}>ชื่อซัพพลายเออร์</label>
        <input
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full"
          placeholder={value.supplier_type === 'individual' ? 'เช่น คุณสมชาย ใจดี' : 'เช่น บริษัท วัสดุก่อสร้าง จำกัด'}
        />
      </div>

      <div>
        <label className={fieldLabel}>ที่อยู่</label>
        <textarea value={value.address || ''} onChange={(e) => onChange({ address: e.target.value })} className="w-full" rows={3} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={fieldLabel}>เลขประจำตัวผู้เสียภาษี</label>
          <input value={value.tax_id || ''} onChange={(e) => onChange({ tax_id: e.target.value })} className="w-full" />
        </div>
        <div>
          <label className={fieldLabel}>สำนักงาน/สาขาเลขที่</label>
          <input value={value.branch_code || ''} onChange={(e) => onChange({ branch_code: e.target.value })} className="w-full" placeholder="00000 (สำนักงานใหญ่)" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
        <button
          type="button"
          onClick={() => setShowContact((v) => !v)}
          className="flex w-full items-center justify-between text-[13px] font-medium text-slate-600"
        >
          <span>ข้อมูลผู้ติดต่อ</span>
          <span className="flex items-center gap-1 text-indigo-600">
            {showContact ? 'ซ่อนข้อมูล' : 'แสดงข้อมูล'}
            {showContact ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
        {showContact && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <input
                value={value.contact_name || ''}
                onChange={(e) => onChange({ contact_name: e.target.value })}
                className="w-full"
                placeholder="ชื่อผู้ติดต่อ"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <input value={value.email || ''} onChange={(e) => onChange({ email: e.target.value })} className="w-full" placeholder="E-mail" />
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <input value={value.phone || ''} onChange={(e) => onChange({ phone: e.target.value })} className="w-full" placeholder="โทรศัพท์" />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className={fieldLabel}>เงื่อนไขชำระเงิน</label>
        <select
          value={isPresetTerm ? value.payment_terms || '' : CUSTOM_TERM}
          onChange={(e) => onChange({ payment_terms: e.target.value === CUSTOM_TERM ? '' : e.target.value })}
          className="w-full"
        >
          <option value="">ไม่ระบุ</option>
          {PAYMENT_TERM_PRESETS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={CUSTOM_TERM}>{CUSTOM_TERM}</option>
        </select>
        {!isPresetTerm && (
          <input
            value={value.payment_terms || ''}
            onChange={(e) => onChange({ payment_terms: e.target.value })}
            className="mt-2 w-full"
            placeholder="ระบุเงื่อนไขชำระเงิน"
          />
        )}
      </div>
    </div>
  )
}
