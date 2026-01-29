'use client'

import React from 'react'
import { Page, Text, View, Document, StyleSheet, Font } from '@react-pdf/renderer'

// [FIXED] ใช้ Link ตรงจาก CDN (ไม่ต้องมีไฟล์ในเครื่อง ไม่ต้องตั้งค่า Vercel)
Font.register({
  family: 'Sarabun',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Regular.ttf' },
    { src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Bold.ttf', fontWeight: 'bold' }
  ]
})

// --- Styles (เหมือนเดิม ไม่ต้องแก้) ---
const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Sarabun', fontSize: 10, color: '#333' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  companyInfo: { width: '60%' },
  docInfo: { width: '35%', textAlign: 'right' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#4F46E5', marginBottom: 5 },
  
  box: { border: '1px solid #e5e7eb', padding: 8, borderRadius: 4, marginBottom: 15 },
  label: { color: '#6b7280', fontSize: 9, marginBottom: 2 },
  value: { fontSize: 10, fontWeight: 'bold' },

  table: { width: '100%', border: '1px solid #e5e7eb', marginBottom: 20 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb', padding: 6 },
  tableRow: { flexDirection: 'row', borderBottom: '1px solid #f3f4f6', padding: 6, alignItems: 'center' },
  
  col1: { width: '5%', textAlign: 'center' },
  col2: { width: '55%' },
  col3: { width: '10%', textAlign: 'center' },
  col4: { width: '15%', textAlign: 'right' },
  col5: { width: '15%', textAlign: 'right' },

  summarySection: { flexDirection: 'row', justifyContent: 'flex-end' },
  summaryTable: { width: '45%' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  netAmount: { fontSize: 14, fontWeight: 'bold', color: '#059669', borderTop: '1px solid #000', paddingTop: 4 },

  footer: { position: 'absolute', bottom: 30, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between' },
  signatureBox: { width: '30%', borderTop: '1px solid #ccc', paddingTop: 8, textAlign: 'center', fontSize: 9 }
})

export const BillingPdf = ({ data }: { data: any }) => {
  // คำนวณยอดต่างๆ
  const totalBase = (data.total_work_amount || 0) + (data.total_add_amount || 0)
  const whtAmount = (totalBase * (data.wht_percent || 0)) / 100
  const retentionAmount = (totalBase * (data.retention_percent || 0)) / 100

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        
        {/* Header */}
        <View style={styles.header}>
            <View style={styles.companyInfo}>
                <Text style={styles.title}>ใบวางบิล / ใบแจ้งหนี้</Text>
                <Text style={{ fontSize: 12, fontWeight: 'bold' }}>บริษัท บิลด์โฟลว์ โปร จำกัด (สำนักงานใหญ่)</Text>
                <Text>123 ถ.ก่อสร้าง แขวงบางนา เขตบางนา กรุงเทพฯ 10260</Text>
                <Text>เลขประจำตัวผู้เสียภาษี: 0105555555555</Text>
                <Text>โทร: 02-999-9999</Text>
            </View>
            <View style={styles.docInfo}>
                <Text style={styles.label}>เลขที่เอกสาร</Text>
                <Text style={{ fontSize: 14, fontWeight: 'bold' }}>INV-{String(data.doc_no).padStart(4, '0')}</Text>
                <Text style={styles.label}>วันที่</Text>
                <Text>{new Date(data.billing_date).toLocaleDateString('th-TH')}</Text>
            </View>
        </View>

        {/* Customer Info */}
        <View style={styles.box}>
            <Text style={styles.label}>ลูกค้า / ผู้รับเหมา</Text>
            <Text style={styles.value}>{data.contractors?.name}</Text>
            <Text>โครงการ: {data.projects?.name}</Text>
            <Text>ที่อยู่: {data.contractors?.address || '-'}</Text>
            <Text>โทร: {data.contractors?.phone || '-'}</Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
            <View style={styles.tableHeader}>
                <Text style={styles.col1}>#</Text>
                <Text style={styles.col2}>รายการ (Description)</Text>
                <Text style={styles.col3}>หน่วย</Text>
                <Text style={styles.col4}>ราคา/หน่วย</Text>
                <Text style={styles.col5}>จำนวนเงิน</Text>
            </View>

            {/* Loop Jobs */}
            {data.billing_jobs?.map((job: any, i: number) => (
                <View key={`job-${i}`} style={styles.tableRow}>
                    <Text style={styles.col1}>{i + 1}</Text>
                    <Text style={styles.col2}>
                        {job.job_assignments?.boq_master?.item_name} (แปลง {job.job_assignments?.plots?.name})
                    </Text>
                    <Text style={styles.col3}>{job.job_assignments?.boq_master?.unit}</Text>
                    <Text style={styles.col4}>-</Text> 
                    <Text style={styles.col5}>{job.amount?.toLocaleString()}</Text>
                </View>
            ))}

            {/* Loop Adjustments (Additions) */}
            {data.billing_adjustments?.filter((a: any) => a.type === 'addition').map((adj: any, i: number) => (
                <View key={`adj-${i}`} style={styles.tableRow}>
                    <Text style={styles.col1}>+</Text>
                    <Text style={styles.col2}>{adj.description} (งานเพิ่ม)</Text>
                    <Text style={styles.col3}>{adj.quantity} {adj.unit}</Text>
                    <Text style={styles.col4}>{adj.unit_price?.toLocaleString()}</Text>
                    <Text style={styles.col5}>{adj.total_amount?.toLocaleString()}</Text>
                </View>
            ))}

             {/* Loop Adjustments (Deductions) */}
             {data.billing_adjustments?.filter((a: any) => a.type === 'deduction').map((adj: any, i: number) => (
                <View key={`ded-${i}`} style={styles.tableRow}>
                    <Text style={styles.col1}>-</Text>
                    <Text style={{ ...styles.col2, color: '#dc2626' }}>{adj.description} (รายการหัก)</Text>
                    <Text style={styles.col3}>{adj.quantity} {adj.unit}</Text>
                    <Text style={styles.col4}>{adj.unit_price?.toLocaleString()}</Text>
                    <Text style={{ ...styles.col5, color: '#dc2626' }}>-{adj.total_amount?.toLocaleString()}</Text>
                </View>
            ))}
        </View>

        {/* Summary Footer */}
        <View style={styles.summarySection}>
            <View style={styles.summaryTable}>
                <View style={styles.summaryRow}>
                    <Text>รวมค่างาน (Subtotal)</Text>
                    <Text>{(totalBase).toLocaleString()}</Text>
                </View>
                
                {data.total_deduct_amount > 0 && (
                     <View style={styles.summaryRow}>
                        <Text style={{color: '#dc2626'}}>รายการหัก (Deductions)</Text>
                        <Text style={{color: '#dc2626'}}>-{data.total_deduct_amount?.toLocaleString()}</Text>
                    </View>
                )}

                {whtAmount > 0 && (
                    <View style={styles.summaryRow}>
                        <Text>หัก ณ ที่จ่าย ({data.wht_percent}%)</Text>
                        <Text>-{whtAmount.toLocaleString()}</Text>
                    </View>
                )}
                
                 {retentionAmount > 0 && (
                    <View style={styles.summaryRow}>
                        <Text>หักประกันผลงาน ({data.retention_percent}%)</Text>
                        <Text>-{retentionAmount.toLocaleString()}</Text>
                    </View>
                )}

                <View style={styles.summaryRow}>
                    <Text style={styles.netAmount}>ยอดสุทธิ (Net Payment)</Text>
                    <Text style={styles.netAmount}>฿{data.net_amount?.toLocaleString()}</Text>
                </View>
            </View>
        </View>

        {/* Signatures */}
        <View style={styles.footer}>
            <View style={styles.signatureBox}>
                <Text>ผู้จัดทำ (Prepared By)</Text>
                <Text style={{ marginTop: 20 }}>_______________________</Text>
            </View>
            <View style={styles.signatureBox}>
                <Text>ผู้อนุมัติ (Approved By)</Text>
                <Text style={{ marginTop: 20 }}>_______________________</Text>
            </View>
            <View style={styles.signatureBox}>
                <Text>ผู้รับเงิน (Received By)</Text>
                <Text style={{ marginTop: 20 }}>_______________________</Text>
            </View>
        </View>

      </Page>
    </Document>
  )
}