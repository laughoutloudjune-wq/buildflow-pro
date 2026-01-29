'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Trash2, Calculator, Briefcase, FileMinus, FilePlus } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { getBillingOptions, getBillableJobs, createBilling } from '@/actions/billing-actions'

export default function CreateBillingPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // --- State ข้อมูล ---
  const [projects, setProjects] = useState<any[]>([])
  const [contractors, setContractors] = useState<any[]>([])
  
  // --- Form Header ---
  const [projectId, setProjectId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [billingDate, setBillingDate] = useState(new Date().toISOString().split('T')[0])

  // --- Jobs Selection ---
  const [availableJobs, setAvailableJobs] = useState<any[]>([]) // งานที่ดึงมา
  const [selectedJobs, setSelectedJobs] = useState<any[]>([])   // งานที่ติ๊กเลือก

  // --- Adjustments (งานเพิ่ม / รายการหัก) ---
  const [adjustments, setAdjustments] = useState<any[]>([])

  // --- Settings ---
  const [whtPercent, setWhtPercent] = useState(3) // หัก ณ ที่จ่าย 3%
  const [retentionPercent, setRetentionPercent] = useState(5) // ประกันผลงาน 5%

  // โหลด Dropdown เริ่มต้น
  useEffect(() => {
    getBillingOptions().then(res => {
      setProjects(res.projects)
      setContractors(res.contractors)
    })
  }, [])

  // เมื่อเลือก Project + Contractor -> ดึงงานมาโชว์
  useEffect(() => {
    if (projectId && contractorId) {
      getBillableJobs(projectId, contractorId).then(jobs => {
        setAvailableJobs(jobs)
        setSelectedJobs([]) // Reset การเลือก
      })
    }
  }, [projectId, contractorId])

  // ฟังก์ชันเพิ่มรายการ Adjustment (งานเพิ่ม/งานหัก)
  const addAdjustment = (type: 'addition' | 'deduction') => {
    setAdjustments([
      ...adjustments, 
      { id: Date.now(), type, description: '', unit: 'เหมา', quantity: 1, unit_price: 0 }
    ])
  }

  // ฟังก์ชันลบรายการ Adjustment
  const removeAdjustment = (id: number) => {
    setAdjustments(adjustments.filter(adj => adj.id !== id))
  }

  // ฟังก์ชันแก้ไข Adjustment
  const updateAdjustment = (id: number, field: string, value: any) => {
    setAdjustments(adjustments.map(adj => adj.id === id ? { ...adj, [field]: value } : adj))
  }

  // ฟังก์ชันติ๊กเลือกงาน
  const toggleJob = (job: any, isChecked: boolean) => {
    if (isChecked) {
      // Default ให้เบิกเท่ายอดคงเหลือ (แต่แก้ได้)
      setSelectedJobs([...selectedJobs, { ...job, request_amount: job.remaining }])
    } else {
      setSelectedJobs(selectedJobs.filter(j => j.id !== job.id))
    }
  }

  // ฟังก์ชันแก้ตัวเลขยอดเบิกของงาน
  const updateJobAmount = (jobId: string, amount: number) => {
    setSelectedJobs(selectedJobs.map(j => j.id === jobId ? { ...j, request_amount: amount } : j))
  }

  // --- Calculation (คำนวณเงินรวม) ---
  const totalWork = selectedJobs.reduce((sum, j) => sum + (parseFloat(j.request_amount) || 0), 0)
  
  const totalAdd = adjustments
    .filter(a => a.type === 'addition')
    .reduce((sum, a) => sum + (a.quantity * a.unit_price), 0)

  const totalDeduct = adjustments
    .filter(a => a.type === 'deduction')
    .reduce((sum, a) => sum + (a.quantity * a.unit_price), 0)

  const baseAmount = totalWork + totalAdd // ยอดฐานเพื่อคิดภาษี (ไม่รวมหัก)
  const whtAmount = (baseAmount * whtPercent) / 100
  const retentionAmount = (baseAmount * retentionPercent) / 100
  
  const netAmount = baseAmount - totalDeduct - whtAmount - retentionAmount

  // --- Submit ---
  const handleSubmit = () => {
    if (!projectId || !contractorId) return alert('กรุณาเลือกโครงการและผู้รับเหมา')
    if (selectedJobs.length === 0 && adjustments.length === 0) return alert('กรุณาเลือกรายการที่จะเบิก')

    const payload = {
      project_id: projectId,
      contractor_id: contractorId,
      billing_date: billingDate,
      selected_jobs: selectedJobs,
      adjustments: adjustments,
      total_work_amount: totalWork,
      total_add_amount: totalAdd,
      total_deduct_amount: totalDeduct,
      wht_percent: whtPercent,
      retention_percent: retentionPercent,
      net_amount: netAmount
    }

    startTransition(async () => {
      try {
        await createBilling(payload)
        router.push('/dashboard/billing')
      } catch (error) {
        console.error(error)
        alert('บันทึกไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full">
          <ArrowLeft className="h-5 w-5 text-slate-500" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">สร้างใบเบิกงวดงาน</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Form Inputs */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* 1. Header Info */}
          <Card className="p-6 space-y-4">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-indigo-500"/> ข้อมูลทั่วไป
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
               <div>
                 <label className="block text-sm text-slate-500 mb-1">วันที่เอกสาร</label>
                 <input type="date" value={billingDate} onChange={e => setBillingDate(e.target.value)} className="w-full border rounded p-2" />
               </div>
               <div></div> {/* Spacer */}
               
               <div>
                 <label className="block text-sm text-slate-500 mb-1">เลือกโครงการ</label>
                 <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full border rounded p-2">
                   <option value="">-- เลือก --</option>
                   {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                 </select>
               </div>
               <div>
                 <label className="block text-sm text-slate-500 mb-1">เลือกผู้รับเหมา</label>
                 <select value={contractorId} onChange={e => setContractorId(e.target.value)} className="w-full border rounded p-2">
                   <option value="">-- เลือก --</option>
                   {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                 </select>
               </div>
            </div>
          </Card>

          {/* 2. Job Selection */}
          {projectId && contractorId && (
            <Card className="p-0 overflow-hidden">
               <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                 <h3 className="font-bold text-slate-700">เลือกรายการงาน (Job List)</h3>
                 <span className="text-xs text-slate-500">เลือกงานที่ต้องการเบิกในงวดนี้</span>
               </div>
               <div className="max-h-[300px] overflow-y-auto">
                 <table className="w-full text-sm text-left">
                   <thead className="bg-white sticky top-0 shadow-sm">
                     <tr>
                       <th className="p-3 w-[40px]"></th>
                       <th className="p-3">ชื่องาน / แปลง</th>
                       <th className="p-3 text-right">คงเหลือให้เบิก</th>
                       <th className="p-3 w-[150px]">ยอดที่จะเบิก</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                     {availableJobs.length === 0 ? (
                       <tr><td colSpan={4} className="p-6 text-center text-slate-400">ไม่พบงานที่เบิกได้</td></tr>
                     ) : (
                       availableJobs.map(job => {
                         const isSelected = selectedJobs.some(s => s.id === job.id)
                         return (
                           <tr key={job.id} className={isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}>
                             <td className="p-3 text-center">
                               <input 
                                 type="checkbox" 
                                 checked={isSelected} 
                                 onChange={(e) => toggleJob(job, e.target.checked)}
                                 className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                               />
                             </td>
                             <td className="p-3">
                               <div className="font-medium">{job.boq_master?.item_name}</div>
                               <div className="text-xs text-slate-500">แปลง {job.plots?.name}</div>
                             </td>
                             <td className="p-3 text-right text-slate-500">
                               ฿{job.remaining.toLocaleString()}
                             </td>
                             <td className="p-3">
                               {isSelected && (
                                 <input 
                                   type="number" 
                                   className="w-full border rounded px-2 py-1 text-right font-bold text-indigo-600"
                                   value={selectedJobs.find(s => s.id === job.id)?.request_amount}
                                   onChange={(e) => updateJobAmount(job.id, parseFloat(e.target.value))}
                                 />
                               )}
                             </td>
                           </tr>
                         )
                       })
                     )}
                   </tbody>
                 </table>
               </div>
               <div className="p-3 bg-slate-50 border-t text-right font-bold text-slate-700">
                 รวมค่างาน: ฿{totalWork.toLocaleString()}
               </div>
            </Card>
          )}

          {/* 3. Adjustments (งานเพิ่ม/ลด) */}
          <Card className="p-6 space-y-4">
             <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-700">รายการปรับปรุง (Adjustments)</h3>
                <div className="flex gap-2">
                   <button onClick={() => addAdjustment('addition')} className="text-xs flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
                      <FilePlus className="h-3 w-3"/> งานเพิ่ม (DC)
                   </button>
                   <button onClick={() => addAdjustment('deduction')} className="text-xs flex items-center gap-1 px-3 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">
                      <FileMinus className="h-3 w-3"/> รายการหัก
                   </button>
                </div>
             </div>
             
             {adjustments.length === 0 && <div className="text-center py-6 text-slate-400 border border-dashed rounded-lg">ไม่มีรายการปรับปรุง</div>}

             {adjustments.map((adj, index) => (
                <div key={adj.id} className={`grid grid-cols-12 gap-2 items-center p-3 rounded border ${adj.type === 'addition' ? 'bg-blue-50/50 border-blue-100' : 'bg-red-50/50 border-red-100'}`}>
                   <div className="col-span-1 text-center">
                      {adj.type === 'addition' ? <Plus className="h-4 w-4 text-blue-500"/> : <FileMinus className="h-4 w-4 text-red-500"/>}
                   </div>
                   <div className="col-span-4">
                      <input 
                        placeholder="รายละเอียด" 
                        value={adj.description}
                        onChange={e => updateAdjustment(adj.id, 'description', e.target.value)}
                        className="w-full text-sm border p-1 rounded"
                      />
                   </div>
                   <div className="col-span-2">
                      <input 
                        placeholder="หน่วย" 
                        value={adj.unit}
                        onChange={e => updateAdjustment(adj.id, 'unit', e.target.value)}
                        className="w-full text-sm border p-1 rounded text-center"
                      />
                   </div>
                   <div className="col-span-2">
                      <input 
                        type="number" placeholder="จำนวน" 
                        value={adj.quantity}
                        onChange={e => updateAdjustment(adj.id, 'quantity', e.target.value)}
                        className="w-full text-sm border p-1 rounded text-center"
                      />
                   </div>
                   <div className="col-span-2">
                      <input 
                        type="number" placeholder="ราคา/หน่วย" 
                        value={adj.unit_price}
                        onChange={e => updateAdjustment(adj.id, 'unit_price', e.target.value)}
                        className="w-full text-sm border p-1 rounded text-right"
                      />
                   </div>
                   <div className="col-span-1 text-center">
                      <button onClick={() => removeAdjustment(adj.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4"/></button>
                   </div>
                </div>
             ))}
          </Card>

        </div>

        {/* Right Column: Summary */}
        <div className="lg:col-span-1">
          <Card className="p-6 sticky top-6 space-y-6 shadow-lg border-indigo-100">
             <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b pb-3">
                <Calculator className="h-5 w-5 text-indigo-600"/> สรุปยอดเบิก
             </h3>
             
             <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                   <span className="text-slate-500">รวมค่างานตามสัญญา</span>
                   <span className="font-medium">฿{totalWork.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-blue-600">
                   <span>+ งานเพิ่ม (DC)</span>
                   <span>฿{totalAdd.toLocaleString()}</span>
                </div>
                
                <div className="border-t pt-2 mt-2 font-bold flex justify-between">
                   <span>ฐานคำนวณภาษี</span>
                   <span>฿{baseAmount.toLocaleString()}</span>
                </div>

                <div className="flex justify-between text-red-600 pt-2">
                   <span>- รายการหัก (Deduction)</span>
                   <span>฿{totalDeduct.toLocaleString()}</span>
                </div>

                {/* Settings Input */}
                <div className="bg-slate-50 p-3 rounded space-y-2 mt-2">
                   <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">หัก ณ ที่จ่าย (%)</label>
                      <input 
                        type="number" value={whtPercent} 
                        onChange={e => setWhtPercent(parseFloat(e.target.value))}
                        className="w-12 text-right border rounded text-xs p-1"
                      />
                   </div>
                   <div className="flex justify-between text-xs text-slate-400 pl-2">
                      <span>ยอดหัก</span>
                      <span>-฿{whtAmount.toLocaleString()}</span>
                   </div>

                   <div className="flex items-center justify-between pt-1">
                      <label className="text-xs text-slate-500">หักประกันผลงาน (%)</label>
                      <input 
                        type="number" value={retentionPercent} 
                        onChange={e => setRetentionPercent(parseFloat(e.target.value))}
                        className="w-12 text-right border rounded text-xs p-1"
                      />
                   </div>
                   <div className="flex justify-between text-xs text-slate-400 pl-2">
                      <span>ยอดหัก</span>
                      <span>-฿{retentionAmount.toLocaleString()}</span>
                   </div>
                </div>

                <div className="border-t border-dashed pt-4 mt-4">
                   <div className="flex justify-between items-end">
                      <span className="font-bold text-lg text-slate-800">ยอดสุทธิ</span>
                      <span className="font-bold text-2xl text-emerald-600">฿{netAmount.toLocaleString()}</span>
                   </div>
                   <p className="text-xs text-right text-slate-400 mt-1">(Net Payment)</p>
                </div>
             </div>

             <button 
                onClick={handleSubmit}
                disabled={isPending}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-md transition disabled:opacity-50"
             >
                {isPending ? 'กำลังบันทึก...' : 'บันทึกใบวางบิล'}
             </button>
          </Card>
        </div>

      </div>
    </div>
  )
}