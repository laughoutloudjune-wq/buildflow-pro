'use client'

import { useState, useEffect } from 'react'
import { X, Printer, FileText, Loader2, Trash2 } from 'lucide-react'
import dynamic from 'next/dynamic'
import { deleteBilling, getBillingById } from '@/actions/billing-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { BillingPdf } from '@/components/pdf/BillingPdf'
import { formatCurrency } from '@/lib/currency'

// Dynamic Import แก้ PDF Loading
const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[400px] text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">กำลังสร้างเอกสาร PDF...</span>
      </div>
    ),
  }
)

interface BillingModalProps {
  billingId: string | null
  onClose: () => void
  onDeleted?: () => void
}

export default function BillingModal({ billingId, onClose, onDeleted }: BillingModalProps) {
  const [billing, setBilling] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'details' | 'pdf'>('details')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (billingId) {
      setLoading(true)
      Promise.all([
        getBillingById(billingId),
        getOrganizationSettings()
      ]).then(([billingData, settingsData]) => {
        setBilling(billingData)
        setSettings(settingsData)
        setLoading(false)
      })
    } else {
      setBilling(null)
      setSettings(null)
    }
  }, [billingId])

  // คำนวณตัวเลขเพื่อแสดงผลในหน้า Details
  const calculateDetails = (data: any) => {
    if (!data) return { wht: 0, retention: 0, totalBase: 0 }
    const totalBase = (data.total_work_amount || 0) + (data.total_add_amount || 0)
    const wht = (totalBase * (data.wht_percent || 0)) / 100
    const retention = (totalBase * (data.retention_percent || 0)) / 100
    return { wht, retention, totalBase }
  }

  const { wht, retention, totalBase } = calculateDetails(billing)
  const plotLabel = billing?.plots?.name
    || (billing?.billing_jobs || [])
      .map((j: any) => j.job_assignments?.plots?.name)
      .filter(Boolean)
      .join(', ')

  const handleDelete = async () => {
    if (!billingId || isDeleting) return;
    console.log('handleDelete called for billingId:', billingId);
    const confirmDelete = window.confirm('ยืนยันการลบประวัติใบเบิกงวดนี้?');
    console.log('window.confirm returned:', confirmDelete);
    if (!confirmDelete) return;

    setIsDeleting(true);
    try {
      await deleteBilling(billingId);
      onClose();
      onDeleted?.();
    } catch (error) {
      console.error('Error in handleDelete:', error);
      alert('ลบรายการไม่สำเร็จ');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!billingId) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity ${billingId ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div className="bg-white w-full max-w-4xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600"/> 
              รายละเอียดใบวางบิล #{billing?.doc_no ? String(billing.doc_no).padStart(4, '0') : '...'}
            </h2>
            <p className="text-xs text-slate-500">โครงการ: {billing?.projects?.name}{plotLabel ? ` • แปลง ${plotLabel}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={isDeleting || !billing}
              className="p-2 hover:bg-red-50 rounded-full transition disabled:opacity-50"
              title="ลบประวัติ"
            >
              <Trash2 className="h-5 w-5 text-red-500" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
           <button 
             onClick={() => setActiveTab('details')}
             className={`flex-1 py-3 text-sm font-bold transition ${activeTab === 'details' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-50'}`}
           >
             รายละเอียด (View)
           </button>
           <button 
             onClick={() => setActiveTab('pdf')}
             className={`flex-1 py-3 text-sm font-bold transition flex items-center justify-center gap-2 ${activeTab === 'pdf' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-50'}`}
           >
             <Printer className="h-4 w-4"/> ตัวอย่างก่อนพิมพ์ (Print Preview)
           </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-slate-100 p-6">
           {loading ? (
             <div className="flex h-full items-center justify-center text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin"/>
             </div>
           ) : (
             <>
               {/* 1. View Details Mode */}
               {activeTab === 'details' && billing && (
                 <div className="space-y-6 max-w-3xl mx-auto">
                    {/* ข้อมูลสรุป */}
                    <div className="bg-white p-6 rounded-lg shadow-sm border space-y-4">
                       <div className="flex justify-between">
                          <div>
                             <label className="text-xs text-slate-500">ผู้รับเหมา</label>
                             <div className="font-bold text-slate-800">{billing.contractors?.name}</div>
                             <div className="text-sm text-slate-500">{billing.contractors?.phone || '-'}</div>
                             <div className="text-xs text-slate-500 mt-1">แปลง: {plotLabel || '-'}</div>
                          </div>
                          <div className="text-right">
                             <label className="text-xs text-slate-500">วันที่เอกสาร</label>
                             <div className="font-bold text-slate-800">{new Date(billing.billing_date).toLocaleDateString('th-TH')}</div>
                             <div className={`text-xs font-bold mt-1 px-2 py-0.5 rounded-full inline-block ${billing.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'}`}>
                                {billing.status}
                             </div>
                          </div>
                       </div>
                    </div>

                    {/* ตารางรายการ */}
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                       <table className="w-full text-sm text-left">
                          <thead className="bg-slate-50 text-slate-600 border-b">
                             <tr>
                                <th className="p-3">รายการ</th>
                                <th className="p-3 text-right">จำนวนเงิน</th>
                             </tr>
                          </thead>
                          <tbody className="divide-y">
                             {/* [FIXED] เพิ่ม Key */}
                             {billing.billing_jobs?.map((job: any) => (
                                <tr key={`job-${job.id}`}>
                                   <td className="p-3">
                                      <div className="font-medium text-slate-700">{job.job_assignments?.boq_master?.item_name}</div>
                                      <div className="text-xs text-slate-400">แปลง {job.job_assignments?.plots?.name}</div>
                                   </td>
                                   <td className="p-3 text-right">฿{formatCurrency(job.amount)}</td>
                                </tr>
                             ))}
                             
                             {/* [FIXED] เพิ่ม Key */}
                             {billing.billing_adjustments?.map((adj: any) => {
                               const total_amount = (adj.quantity || 0) * (adj.unit_price || 0);
                               return (
                                 <tr key={`adj-${adj.id}`} className={adj.type === 'deduction' ? 'text-red-600 bg-red-50/30' : 'text-blue-600 bg-blue-50/30'}>
                                    <td className="p-3">
                                       {adj.type === 'addition' ? '[+]' : '[-]'} {adj.description} ({adj.quantity} {adj.unit})
                                    </td>
                                    <td className="p-3 text-right">
                                       {adj.type === 'deduction' ? '-' : ''}฿{formatCurrency(total_amount)}
                                    </td>
                                 </tr>
                               );
                             })}
                          </tbody>
                          <tfoot className="bg-slate-50 text-slate-700">
                             {/* [NEW] แสดงรายละเอียด หักภาษี / ประกัน */}
                             <tr>
                                <td className="p-3 text-right font-bold">รวมค่างาน (Subtotal)</td>
                                <td className="p-3 text-right font-bold">฿{formatCurrency(totalBase)}</td>
                             </tr>

                             {billing.total_deduct_amount > 0 && (
                                <tr>
                                   <td className="p-3 text-right text-red-600">รายการหัก (Deduction)</td>
                                   <td className="p-3 text-right text-red-600">-฿{formatCurrency(billing.total_deduct_amount)}</td>
                                </tr>
                             )}

                             {wht > 0 && (
                                <tr>
                                   <td className="p-3 text-right text-slate-500">หัก ณ ที่จ่าย ({billing.wht_percent}%)</td>
                                   <td className="p-3 text-right text-slate-500">-฿{formatCurrency(wht)}</td>
                                </tr>
                             )}

                             {retention > 0 && (
                                <tr>
                                   <td className="p-3 text-right text-slate-500">หักประกันผลงาน ({billing.retention_percent}%)</td>
                                   <td className="p-3 text-right text-slate-500">-฿{formatCurrency(retention)}</td>
                                </tr>
                             )}

                             {/* Net Amount */}
                             <tr className="bg-emerald-50 text-emerald-700">
                                <td className="p-3 text-right text-lg font-bold">ยอดสุทธิ (Net Amount)</td>
                                <td className="p-3 text-right text-lg font-bold">฿{formatCurrency(billing.net_amount)}</td>
                             </tr>
                          </tfoot>
                       </table>
                    </div>
                 </div>
               )}

               {/* 2. PDF Preview Mode */}
               {activeTab === 'pdf' && billing && (
                 <div className="h-full w-full bg-slate-500 rounded-lg shadow-inner overflow-hidden flex flex-col">
                    <PDFViewer className="w-full h-full border-none">
                       <BillingPdf data={billing} settings={settings} />
                    </PDFViewer>
                 </div>
               )}
             </>
           )}
        </div>
      </div>
    </div>
  )
}
