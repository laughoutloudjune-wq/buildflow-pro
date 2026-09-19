'use client'

import { Page, Text, View, Document, StyleSheet, Font, Image } from '@react-pdf/renderer'
import type { SignatureSlot } from '@/lib/types/signatures'
import type { SaleReceiptData } from '@/actions/sale-payments-actions'

// Same self-hosted font registration as BillingPdf.tsx - see that file for
// why (a CDN hiccup silently drops Thai glyphs instead of erroring).
Font.register({
  family: 'Sarabun',
  fonts: [
    { src: '/fonts/Sarabun-Regular.ttf' },
    { src: '/fonts/Sarabun-Bold.ttf', fontWeight: 'bold' },
  ],
})

const styles = StyleSheet.create({
  page: { padding: 30, fontFamily: 'Sarabun', fontSize: 10, color: '#333' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  companyInfo: { width: '60%', paddingRight: 10 },
  docInfo: { width: '35%', textAlign: 'right' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#4F46E5', marginBottom: 5 },
  box: { border: '1px solid #e5e7eb', padding: 10, paddingRight: 15, borderRadius: 4, marginBottom: 15 },
  label: { color: '#6b7280', fontSize: 9, marginBottom: 2 },
  value: { fontSize: 10, fontWeight: 'bold' },
  amountBox: {
    border: '1px solid #059669',
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  amountLabel: { fontSize: 10, color: '#065f46' },
  amountValue: { fontSize: 26, fontWeight: 'bold', color: '#059669', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottom: '1px solid #f3f4f6' },
  footer: { position: 'absolute', bottom: 30, left: 30, right: 30, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20, rowGap: 10 },
  signatureBox: { width: 140, borderTop: '1px solid #ccc', paddingTop: 8, textAlign: 'center', fontSize: 9 },
  signatureImage: { height: 30, marginTop: 4, objectFit: 'contain' },
})

const KIND_LABEL: Record<string, string> = {
  booking: 'เงินจอง',
  contract: 'เงินทำสัญญา',
  down: 'เงินผ่อนดาวน์',
  transfer: 'เงินวันโอนกรรมสิทธิ์',
  extra: 'เงินอื่นๆ',
}

export function SaleReceiptPdf({
  data,
  settings,
  slots,
}: {
  data: SaleReceiptData
  settings: { company_name?: string; tax_id?: string } | null
  slots: SignatureSlot[]
}) {
  const { payment } = data
  const companyName = settings?.company_name || 'Your Company Name'
  const companyTaxId = settings?.tax_id || 'Your Tax ID'
  const kindLabel = KIND_LABEL[payment.kind] || payment.kind
  const installmentSuffix = payment.installmentNo ? ` งวดที่ ${payment.installmentNo}` : ''

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.companyInfo}>
            <Text style={styles.title}>ใบเสร็จรับเงิน</Text>
            <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{companyName} (สำนักงานใหญ่)</Text>
            <Text>โครงการ: {data.projectName}</Text>
            <Text>เลขประจำตัวผู้เสียภาษี: {companyTaxId}</Text>
          </View>
          <View style={styles.docInfo}>
            <Text style={styles.label}>เลขที่ใบเสร็จ</Text>
            <Text style={{ fontSize: 14, fontWeight: 'bold' }}>{payment.receiptNo || '-'}</Text>
            <Text style={styles.label}>วันที่</Text>
            <Text>{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('th-TH') : '-'}</Text>
          </View>
        </View>

        <View style={styles.box}>
          <Text style={styles.label}>ได้รับเงินจาก</Text>
          <Text style={styles.value}>{data.customerName || '-'}</Text>
          {data.customerPhone && <Text>โทร: {data.customerPhone}</Text>}
          {data.customerAddress && <Text>ที่อยู่: {data.customerAddress}</Text>}
          <Text style={{ marginTop: 6 }}>สำหรับแปลง: {data.plotName}</Text>
        </View>

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>{kindLabel}{installmentSuffix}</Text>
          <Text style={styles.amountValue}>
            ฿{(payment.amountPaid ?? payment.amountDue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </Text>
        </View>

        <View style={styles.box}>
          <View style={styles.row}>
            <Text>วิธีชำระ</Text>
            <Text style={styles.value}>{payment.method || '-'}</Text>
          </View>
          {payment.note && (
            <View style={styles.row}>
              <Text>หมายเหตุ</Text>
              <Text>{payment.note}</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {slots.map((slot) => (
            <View key={slot.id} style={styles.signatureBox}>
              <Text>{slot.label}</Text>
              {slot.signature_url ? (
                <Image src={slot.signature_url} style={styles.signatureImage} />
              ) : (
                <Text style={{ marginTop: 20 }}>_______________________</Text>
              )}
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}
