// Thai baht amount-in-words (คำอ่านจำนวนเงินเป็นตัวอักษร).
//
// Printed on the purchase order under the numeric grand total. Thai
// commercial and tax documents are expected to carry the amount spelled out
// so the figure cannot be altered after signing - a PO showing only digits
// looks unfinished to a supplier's accounts department.
//
// Reading rules this implements:
//   - tens digit 1 reads 'สิบ', not 'หนึ่งสิบ'   (10 = สิบ)
//   - tens digit 2 reads 'ยี่สิบ', not 'สองสิบ'  (20 = ยี่สิบ)
//   - units digit 1 reads 'เอ็ด' when a higher digit precedes it
//     (1 = หนึ่ง, but 11 = สิบเอ็ด and 21 = ยี่สิบเอ็ด)
//   - values of a million and above repeat with 'ล้าน', applied recursively
//     so arbitrarily large amounts still read correctly

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

// Reads a value below one million. Anything larger is split off as ล้าน
// groups by readNumber before reaching here.
function readGroup(value: number): string {
  const digits = String(value)
  let out = ''

  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[i])
    const place = digits.length - i - 1
    if (digit === 0) continue

    if (place === 0) {
      // A lone 1 is หนึ่ง; a trailing 1 after any higher digit is เอ็ด.
      out += digit === 1 && digits.length > 1 ? 'เอ็ด' : DIGITS[digit]
    } else if (place === 1) {
      if (digit === 1) out += 'สิบ'
      else if (digit === 2) out += 'ยี่สิบ'
      else out += DIGITS[digit] + 'สิบ'
    } else {
      out += DIGITS[digit] + PLACES[place]
    }
  }

  return out
}

function readNumber(value: number): string {
  if (value === 0) return DIGITS[0]

  const millions = Math.floor(value / 1_000_000)
  const remainder = value % 1_000_000

  let out = ''
  if (millions > 0) out += readNumber(millions) + 'ล้าน'
  if (remainder > 0) out += readGroup(remainder)
  return out
}

/**
 * Converts a number to Thai baht words.
 *
 *   bahtText(11276)    -> 'หนึ่งหมื่นหนึ่งพันสองร้อยเจ็ดสิบหกบาทถ้วน'
 *   bahtText(1050.25)  -> 'หนึ่งพันห้าสิบบาทยี่สิบห้าสตางค์'
 *   bahtText(0)        -> 'ศูนย์บาทถ้วน'
 */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) return ''

  const negative = amount < 0
  // Work in satang so 0.1 + 0.2 style float drift can't shift the wording.
  const totalSatang = Math.round(Math.abs(amount) * 100)
  const baht = Math.floor(totalSatang / 100)
  const satang = totalSatang % 100

  let words: string
  if (baht === 0 && satang === 0) {
    words = 'ศูนย์บาทถ้วน'
  } else if (satang === 0) {
    words = readNumber(baht) + 'บาทถ้วน'
  } else if (baht === 0) {
    words = readGroup(satang) + 'สตางค์'
  } else {
    words = readNumber(baht) + 'บาท' + readGroup(satang) + 'สตางค์'
  }

  return negative ? 'ลบ' + words : words
}
