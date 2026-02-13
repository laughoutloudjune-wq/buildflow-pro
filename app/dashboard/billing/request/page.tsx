'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { getBillingOptions, getBillableJobs, createBillingRequest } from '@/actions/billing-actions'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { Plus, Trash2, CheckCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

type Project = { id: string; name: string }
type Contractor = { id: string; name: string }
type Job = {
  id: string
  totalBoq: number
  paid: number
  remaining: number
  boq_master: { item_name: string; unit: string }
  plots: { name: string }
  previous_progress: number
}
type Adjustment = {
  type: 'addition' | 'deduction';
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
}

export default function CreateBillingRequestPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedContractor, setSelectedContractor] = useState('')
  const [billableJobs, setBillableJobs] = useState<Job[]>([])
  const [selectedJobs, setSelectedJobs] = useState<Map<string, { progress: string; request_amount: number }>>(new Map())
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [submittedData, setSubmittedData] = useState<any>(null)

  useEffect(() => {
    async function fetchOptions() {
      const { projects, contractors } = await getBillingOptions()
      setProjects(projects)
      setContractors(contractors)
    }
    fetchOptions()
  }, [])

  useEffect(() => {
    if (selectedProject && selectedContractor) {
      async function fetchJobs() {
        setIsLoading(true)
        const jobs = await getBillableJobs(selectedProject, selectedContractor)
        
        const jobsWithProgress = jobs.map(job => ({
          ...job,
          previous_progress: job.totalBoq > 0 ? (job.paid / job.totalBoq) * 100 : 0,
        }));

        setBillableJobs(jobsWithProgress)
        setSelectedJobs(new Map())
        setIsLoading(false)
      }
      fetchJobs()
    }
  }, [selectedProject, selectedContractor])

  const handleJobSelection = (jobId: string, job: Job) => {
    const newSelectedJobs = new Map(selectedJobs)
    if (newSelectedJobs.has(jobId)) {
      newSelectedJobs.delete(jobId)
    } else {
      // Initialize with previous progress as a string placeholder
      newSelectedJobs.set(jobId, { progress: job.previous_progress.toFixed(2), request_amount: 0 })
    }
    setSelectedJobs(newSelectedJobs)
  }

  const handleProgressChange = (jobId: string, job: Job, progressStr: string) => {
    const newSelectedJobs = new Map(selectedJobs);
    
    if (progressStr === '') {
        newSelectedJobs.set(jobId, { progress: '', request_amount: 0 });
        setSelectedJobs(newSelectedJobs);
        return;
    }

    const progress = parseFloat(progressStr);
    if (isNaN(progress) || progress < 0 || progress > 100) {
        // Keep the string in the box but don't update amount if invalid
        newSelectedJobs.set(jobId, { progress: progressStr, request_amount: selectedJobs.get(jobId)?.request_amount || 0 });
        setSelectedJobs(newSelectedJobs);
        return;
    }

    const newAmount = (job.totalBoq * progress / 100) - job.paid;
    
    newSelectedJobs.set(jobId, { progress: progressStr, request_amount: Math.max(0, newAmount) });
    setSelectedJobs(newSelectedJobs);
  }

  const handleAdjustmentChange = (index: number, field: keyof Adjustment, value: any) => {
    const newAdjustments = [...adjustments];
    (newAdjustments[index] as any)[field] = value;
    setAdjustments(newAdjustments);
  };

  const addAdjustment = (type: 'addition' | 'deduction') => {
    setAdjustments([...adjustments, { type, description: '', unit: 'หน่วย', quantity: 1, unit_price: 0 }]);
  };

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_, i) => i !== index));
  };
  
  const { totalWorkAmount, totalAddAmount, totalDeductAmount, netAmount } = useMemo(() => {
    const totalWorkAmount = Array.from(selectedJobs.values()).reduce((sum, job) => sum + job.request_amount, 0)
    const totalAddAmount = adjustments
      .filter(adj => adj.type === 'addition')
      .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0);
    const totalDeductAmount = adjustments
      .filter(adj => adj.type === 'deduction')
      .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0);
    const netAmount = totalWorkAmount + totalAddAmount - totalDeductAmount;
    return { totalWorkAmount, totalAddAmount, totalDeductAmount, netAmount };
  }, [selectedJobs, adjustments])

  const handleSubmit = async () => {
    setError(null)
    if (!selectedProject || !selectedContractor) {
      setError("กรุณาเลือกโครงการและผู้รับเหมา")
      return
    }
    if (selectedJobs.size === 0 && adjustments.length === 0) {
        setError("กรุณาเลือกงานที่ต้องการเบิก หรือเพิ่มรายการปรับปรุงอย่างน้อย 1 รายการ")
        return
    }

    let jobsPayload = [];
    for (const [id, data] of selectedJobs.entries()) {
        const job = billableJobs.find(j => j.id === id);
        if (!job) continue;

        const progress = parseFloat(data.progress);
        if (isNaN(progress)) {
            setError(`ความคืบหน้าของงาน "${job.boq_master.item_name}" ไม่ถูกต้อง`);
            return;
        }

        if (progress <= job.previous_progress) {
            setError(`ความคืบหน้าของงาน "${job.boq_master.item_name}" ต้องมากกว่า ${job.previous_progress.toFixed(2)}%`);
            return;
        }
        jobsPayload.push({
            id,
            progress_percent: progress,
            request_amount: data.request_amount,
        });
    }

    const dataToSubmit = {
      project_id: selectedProject,
      contractor_id: selectedContractor,
      billing_date: new Date().toISOString(),
      note: note,
      selected_jobs: jobsPayload,
      adjustments: adjustments,
      total_work_amount: totalWorkAmount,
      total_add_amount: totalAddAmount,
      total_deduct_amount: totalDeductAmount,
    }

    setIsLoading(true)
    try {
      const result = await createBillingRequest(dataToSubmit)
      setSubmittedData({ ...dataToSubmit, doc_no: result.doc_no, net_amount: netAmount });
      setShowSuccessModal(true);
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleModalClose = () => {
    setShowSuccessModal(false);
    router.push('/dashboard/billing');
  }

  return (
    <div className="container mx-auto p-4">
       {showSuccessModal && submittedData && (
        <Modal isOpen={showSuccessModal} onClose={handleModalClose}>
            <div className="p-4 text-center">
                <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2">ส่งคำขอสำเร็จ!</h2>
                <p className="text-gray-600 mb-4">ใบขอเบิกเลขที่ #{submittedData.doc_no} ถูกส่งเพื่อรอการตรวจสอบแล้ว</p>
                <div className="bg-gray-50 p-4 rounded-lg text-left mb-6">
                    <p><strong>โครงการ:</strong> {projects.find(p => p.id === submittedData.project_id)?.name}</p>
                    <p><strong>ผู้รับเหมา:</strong> {contractors.find(c => c.id === submittedData.contractor_id)?.name}</p>
                    <p className="mt-2 text-lg font-bold">ยอดขอเบิกรวม: <span className="text-blue-600">{formatCurrency(submittedData.net_amount)} บาท</span></p>
                </div>
                <button 
                    onClick={handleModalClose}
                    className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    กลับไปที่หน้ารายการ
                </button>
            </div>
        </Modal>
      )}

      <h1 className="text-2xl font-bold mb-4">สร้างใบขอเบิก (สำหรับ Foreman)</h1>
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">โครงการ</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
            >
              <option value="">เลือกโครงการ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">ผู้รับเหมา</label>
            <select
              value={selectedContractor}
              onChange={(e) => setSelectedContractor(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
            >
              <option value="">เลือกผู้รับเหมา</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {billableJobs.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold mb-2">งานที่สามารถเบิกได้</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">เลือก</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ชื่องาน</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">มูลค่าทั้งหมด</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">เบิกแล้ว</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ความคืบหน้าเดิม %</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ความคืบหน้าปัจจุบัน %</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ยอดขอเบิก</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {billableJobs.map((job) => (
                    <tr key={job.id}>
                      <td className="px-6 py-4"><input type="checkbox" onChange={() => handleJobSelection(job.id, job)} checked={selectedJobs.has(job.id)} /></td>
                      <td className="px-6 py-4">{job.boq_master.item_name} ({job.plots.name})</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(job.totalBoq)}</td>
                      <td className="px-6 py-4 text-right">{formatCurrency(job.paid)}</td>
                      <td className="px-6 py-4 text-right">{job.previous_progress.toFixed(2)}%</td>
                      <td className="px-6 py-4 text-right">
                        {selectedJobs.has(job.id) && (
                          <input
                            type="number"
                            className="w-24 p-1 border border-gray-300 rounded-md text-right"
                            value={selectedJobs.get(job.id)?.progress || ''}
                            onChange={(e) => handleProgressChange(job.id, job, e.target.value)}
                            min={job.previous_progress.toFixed(2)}
                            max="100"
                            step="0.01"
                            placeholder={job.previous_progress.toFixed(2)}
                          />
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">{selectedJobs.has(job.id) ? formatCurrency(selectedJobs.get(job.id)?.request_amount || 0) : '0.00'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Adjustments */}
        <div className="mt-6">
            <h2 className="text-xl font-semibold mb-2">รายการเพิ่มเติม (งานเพิ่ม/งานหัก)</h2>
            {adjustments.map((adj, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 mb-2 items-center">
                    <div className="col-span-2">
                        <select value={adj.type} onChange={(e) => handleAdjustmentChange(index, 'type', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md">
                            <option value="addition">งานเพิ่ม</option>
                            <option value="deduction">งานหัก</option>
                        </select>
                    </div>
                    <div className="col-span-4"><input type="text" placeholder="รายละเอียด" value={adj.description} onChange={e => handleAdjustmentChange(index, 'description', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                    <div className="col-span-1"><input type="text" placeholder="หน่วย" value={adj.unit} onChange={e => handleAdjustmentChange(index, 'unit', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                    <div className="col-span-2"><input type="number" placeholder="จำนวน" value={adj.quantity} onChange={e => handleAdjustmentChange(index, 'quantity', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                    <div className="col-span-2"><input type="number" placeholder="ราคาต่อหน่วย" value={adj.unit_price} onChange={e => handleAdjustmentChange(index, 'unit_price', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                    <div className="col-span-1"><button onClick={() => removeAdjustment(index)} className="p-2 text-red-500 hover:text-red-700"><Trash2 className="h-5 w-5"/></button></div>
                </div>
            ))}
            <button onClick={() => addAdjustment('addition')} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 mt-2"><Plus className="h-4 w-4"/>เพิ่มรายการงานเพิ่ม</button>
            <button onClick={() => addAdjustment('deduction')} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 mt-1"><Plus className="h-4 w-4"/>เพิ่มรายการงานหัก</button>
        </div>

        <div className="mt-6 bg-slate-50 p-4 rounded-lg">
            <h2 className="text-xl font-semibold mb-2">สรุปยอด</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                  <label className="block text-sm font-medium text-gray-700">หมายเหตุ (ถึง PM)</label>
                  <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                      placeholder="ใส่ข้อความเพิ่มเติมถึงผู้ตรวจสอบ..."
                  />
              </div>
              <div className="space-y-2 text-right">
                  <p className="text-gray-500">ยอดเบิกตามเนื้องาน: <span className="font-semibold text-gray-800">{formatCurrency(totalWorkAmount)}</span></p>
                  <p className="text-gray-500">ยอดงานเพิ่ม: <span className="font-semibold text-green-600">{formatCurrency(totalAddAmount)}</span></p>
                  <p className="text-gray-500">ยอดงานหัก: <span className="font-semibold text-red-600">-{formatCurrency(totalDeductAmount)}</span></p>
                  <p className="text-lg font-bold">ยอดรวมขอเบิก: <span className="text-2xl">{formatCurrency(netAmount)}</span></p>
              </div>
            </div>
        </div>

        {error && <p className="mt-4 text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={isLoading || !selectedProject || !selectedContractor}
            className="px-6 py-3 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          >
            {isLoading ? 'กำลังส่ง...' : 'ส่งใบขอเบิกเพื่อตรวจสอบ'}
          </button>
        </div>
      </Card>
    </div>
  )
}
