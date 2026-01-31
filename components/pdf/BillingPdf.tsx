'use client'

import React from 'react'
import { Page, Text, View, Document, StyleSheet, Font } from '@react-pdf/renderer'

// ใช้ CDN Link
Font.register({
  family: 'Sarabun',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Regular.ttf' },
    { src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Bold.ttf', fontWeight: 'bold' }
  ]
})

const styles = StyleSheet.create({
  page: { 
    padding: 30, 
    fontFamily: 'Sarabun', 
    fontSize: 10, 
    color: '#333' 
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginBottom: 20 
  },
  // [แก้] เพิ่ม paddingRight กันตัวอักษรท้ายชื่อบริษัทหาย
  companyInfo: { 
    width: '60%', 
    paddingRight: 10 
  },
  docInfo: { 
    width: '35%', 
    textAlign: 'right' 
  },
  title: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#4F46E5', 
    marginBottom: 5 
  },
  
  // [แก้] เพิ่ม paddingRight ในกล่องผู้รับเหมา
  box: { 
    border: '1px solid #e5e7eb', 
    padding: 10, // เพิ่ม padding รวม
    paddingRight: 15, // เพิ่มพิเศษด้านขวา
    borderRadius: 4, 
    marginBottom: 15 
  },
  label: { color: '#6b7280', fontSize: 9, marginBottom: 2 },
  value: { fontSize: 10, fontWeight: 'bold' },

  table: { width: '100%', border: '1px solid #e5e7eb', marginBottom: 20 },
  tableHeader: { 
    flexDirection: 'row', 
    backgroundColor: '#f9fafb', 
    borderBottom: '1px solid #e5e7eb', 
    paddingVertical: 8,
    paddingHorizontal: 4
  },
  tableRow: { 
    flexDirection: 'row', 
    borderBottom: '1px solid #f3f4f6', 
    paddingVertical: 8, 
    paddingHorizontal: 4,
    alignItems: 'center' 
  },
  
  col1: { width: '5%', textAlign: 'center' },
  col2: { width: '55%', paddingRight: 5 }, 
  col3: { width: '10%', textAlign: 'center' },
  col4: { width: '15%', textAlign: 'right' },
  
  // [แก้] เพิ่ม paddingRight 5px (จากเดิม 2) เพื่อให้คำว่า "จำนวนเงิน" และตัวเลขไม่ขาด
  col5: { width: '15%', textAlign: 'right', paddingRight: 5 }, 

  summarySection: { flexDirection: 'row', justifyContent: 'flex-end' },
  summaryTable: { width: '45%' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  netAmount: { fontSize: 14, fontWeight: 'bold', color: '#059669', borderTop: '1px solid #000', paddingTop: 4 },

  footer: { position: 'absolute', bottom: 30, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between' },
  signatureBox: { width: '30%', borderTop: '1px solid #ccc', paddingTop: 8, textAlign: 'center', fontSize: 9 }
})

export const BillingPdf = ({ data }: { data: any }) => {
  const totalBase = (data.total_work_amount || 0) + (data.total_add_amount || 0)
  // เงินประกันผลงาน หักเฉพาะงานหลัก
  const retentionAmount = (data.total_work_amount || 0) * (data.retention_percent || 0) / 100
  // ภาษี ณ ที่จ่ายหักเฉพาะ งานเพิ่ม
  const whtAmount = (data.total_add_amount || 0) * (data.wht_percent || 0) / 100

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        
        {/* Header */}
        <View style={styles.header}>
            <View style={styles.companyInfo}>
                <Text style={styles.title}>ใบเบิกงวดงาน</Text>
                <Text style={{ fontSize: 12, fontWeight: 'bold' }}>บริษัท บิลด์โฟลว์ โปร จำกัด (สำนักงานใหญ่)</Text>
                <Text>โครงการ: {data.projects?.name}</Text>
                <Text>เลขประจำตัวผู้เสียภาษี: 0105555555555</Text>
            </View>
            <View style={styles.docInfo}>
                <Text style={styles.label}>เลขที่เอกสาร</Text>
                <Text style={{ fontSize: 14, fontWeight: 'bold' }}>REQ-{String(data.doc_no).padStart(4, '0')}</Text>
                <Text style={styles.label}>วันที่</Text>
                <Text>{new Date(data.billing_date).toLocaleDateString('th-TH')}</Text>
            </View>
        </View>

        {/* Contractor Info */}
        <View style={styles.box}>
            <Text style={styles.label}>ผู้รับเหมา / ผู้เบิก</Text>
            {/* เทคนิค: เติม " " (Space) ต่อท้าย เผื่อกรณีสุดวิสัยจริงๆ ให้มันตัด Space แทนตัวอักษร */}
            <Text style={styles.value}>{data.contractors?.name + " "}</Text>
            <Text>ที่อยู่: {data.contractors?.address || '-'}</Text>
            <Text>โทร: {data.contractors?.phone || '-'}</Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
            <View style={styles.tableHeader}>
                <Text style={styles.col1}>#</Text>
                <Text style={styles.col2}>รายการ</Text>
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
                    <Text style={styles.col5}>{job.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                </View>
            ))}

            {/* Adjustments: Addition */}
            {data.billing_adjustments?.filter((a: any) => a.type === 'addition').map((adj: any, i: number) => {
                const total_amount = (adj.quantity || 0) * (adj.unit_price || 0);
                return (
                    <View key={`adj-${i}`} style={styles.tableRow}>
                        <Text style={styles.col1}>+</Text>
                        <Text style={styles.col2}>{adj.description} (งานเพิ่ม)</Text>
                        <Text style={styles.col3}>{adj.quantity} {adj.unit}</Text>
                        <Text style={styles.col4}>{adj.unit_price?.toLocaleString()}</Text>
                        <Text style={styles.col5}>{total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                    </View>
                );
            })}

             {/* Adjustments: Deduction */}
             {data.billing_adjustments?.filter((a: any) => a.type === 'deduction').map((adj: any, i: number) => {
                const total_amount = (adj.quantity || 0) * (adj.unit_price || 0);
                return (
                    <View key={`ded-${i}`} style={styles.tableRow}>
                        <Text style={styles.col1}>-</Text>
                        <Text style={{ ...styles.col2, color: '#dc2626' }}>{adj.description} (รายการหัก)</Text>
                        <Text style={styles.col3}>{adj.quantity} {adj.unit}</Text>
                        <Text style={styles.col4}>{adj.unit_price?.toLocaleString()}</Text>
                        <Text style={{ ...styles.col5, color: '#dc2626' }}>-{total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                    </View>
                );
             })}
        </View>

        {/* Summary Footer */}
        <View style={styles.summarySection}>
            <View style={styles.summaryTable}>
                <View style={styles.summaryRow}>
                    <Text>รวมค่างาน (Subtotal)</Text>
                    <Text>{(totalBase).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                </View>
                
                {data.total_deduct_amount > 0 && (
                     <View style={styles.summaryRow}>
                        <Text style={{color: '#dc2626'}}>รายการหัก (Deductions)</Text>
                        <Text style={{color: '#dc2626'}}>-{data.total_deduct_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                    </View>
                )}

                {whtAmount > 0 && (
                    <View style={styles.summaryRow}>
                        <Text>หัก ณ ที่จ่าย ({data.wht_percent}%)</Text>
                        <Text>-{whtAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                    </View>
                )}
                
                 {retentionAmount > 0 && (
                    <View style={styles.summaryRow}>
                        <Text>หักประกันผลงาน ({data.retention_percent}%)</Text>
                        <Text>-{retentionAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                    </View>
                )}

                <View style={styles.summaryRow}>
                    <Text style={styles.netAmount}>ยอดจ่ายสุทธิ (Net Payment)</Text>
                    <Text style={styles.netAmount}>฿{data.net_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
                </View>
            </View>
        </View>

        {/* Signatures */}
        <View style={styles.footer}>
            <View style={styles.signatureBox}>
                <Text>ผู้เบิก / ผู้รับเหมา</Text>
                <Text style={{ marginTop: 20 }}>_______________________</Text>
            </View>
            <View style={styles.signatureBox}>
                <Text>โฟร์แมน / ผู้ตรวจงาน</Text>
                <Text style={{ marginTop: 20 }}>_______________________</Text>
            </View>
            <View style={styles.signatureBox}>
                <Text>ผู้อนุมัติจ่าย (เจ้าของ)</Text>
                <Text style={{ marginTop: 20 }}>_______________________</Text>
            </View>
        </View>

      </Page>
    </Document>
  )
}