import { expect, test } from '@playwright/test'
import {
  buildPlan,
  nameSimilarity,
  normalizeName,
  similarOldJob,
  suggestPairs,
  type HtcCandidateLine,
  type HtcOldJob,
} from '@/lib/house-type-change'

// Pure-logic coverage for the house type change wizard's name pairing and
// plan building - no page/browser needed.

const job = (id: string, name: string, qty = 1, price = 100): HtcOldJob => ({ id, name, unit: 'หลัง', qty, price, paid: 0 })
const line = (key: string, name: string, qty = 1, price = 100): HtcCandidateLine => ({ key, name, unit: 'หลัง', qty, price, virtual: false })

test('normalizeName ignores spaces, punctuation and Thai digits', () => {
  expect(normalizeName('งานฉาบชั้น 1')).toBe('งานฉาบชั้น1')
  expect(normalizeName('งานสีภายนอกรอบ ๒ (รั้ว)')).toBe('งานสีภายนอกรอบ2รั้ว')
})

test('same job with a small wording change is similar', () => {
  expect(nameSimilarity('งานฉาบผนังชั้น1', 'งานฉาบชั้น 1')).toBeGreaterThanOrEqual(0.62)
  expect(nameSimilarity('งานมุงหลังคาเมลทัลชีส', 'งานมุงหลังคา')).toBeGreaterThanOrEqual(0.62)
  expect(nameSimilarity('งานฉาบผนังภายนอก', 'งานฉาบภายนอก')).toBeGreaterThanOrEqual(0.62)
})

test('different floor, round or upper/lower are never similar', () => {
  expect(nameSimilarity('งานฉาบผนังชั้น1', 'งานฉาบชั้น 2')).toBe(0)
  expect(nameSimilarity('งานสีภายนอกรอบ 1', 'งานสีภายนอกรอบ 2')).toBe(0)
  expect(nameSimilarity('งานติดตั้งฝ้าเพดานชั้นบน', 'งานฝ้าเพดานชั้นล่าง')).toBe(0)
  expect(nameSimilarity('งานทาสีภายนอก', 'งานทาสีภายใน')).toBe(0)
})

test('exact names win, near names fill in, the rest are copied; one line per job', () => {
  const jobs = [job('j1', 'งานก่ออิฐชั้น1'), job('j2', 'งานฉาบผนังชั้น1'), job('j3', 'งานเทพื้นที่จอดรถ'), job('j4', 'งานฉาบผนังชั้น2')]
  const lines = [line('l1', 'งานก่ออิฐชั้น1'), line('l2', 'งานฉาบชั้น 1'), line('l3', 'งานฉาบชั้น 2')]
  const pairs = suggestPairs(jobs, lines)
  expect(pairs.find((p) => p.jobId === 'j1')).toMatchObject({ lineKey: 'l1', kind: 'same' })
  expect(pairs.find((p) => p.jobId === 'j2')).toMatchObject({ lineKey: 'l2', kind: 'near' })
  expect(pairs.find((p) => p.jobId === 'j4')).toMatchObject({ lineKey: 'l3', kind: 'near' })
  expect(pairs.find((p) => p.jobId === 'j3')).toMatchObject({ lineKey: null, kind: 'copy' })
  const keys = pairs.map((p) => p.lineKey).filter(Boolean)
  expect(new Set(keys).size).toBe(keys.length)
})

test('an unpaired line that resembles an old job is flagged', () => {
  expect(similarOldJob(line('x', 'งานโครงหลังคาเหล็ก'), [job('j', 'งานโครงเหล็กหลังคา')])).not.toBeNull()
  expect(similarOldJob(line('x', 'งานรั้วหลังบ้านสูง1.50ม'), [job('j', 'งานโครงเหล็กหลังคา')])).toBeNull()
})

test('buildPlan copies the old line when the new quantity is not approved', () => {
  const jobs = [
    { ...job('j1', 'A', 2), oldLineId: 'old1' },
    { ...job('j2', 'B', 1), oldLineId: 'old2' },
    { ...job('j3', 'C', 1), oldLineId: 'old3' },
  ]
  const lines = [line('l1', 'A', 3), line('l2', 'B', 1), line('seed:s9', 'C', 1), line('l4', 'D')]
  const plan = buildPlan({
    plotId: 'p',
    newHouseModelId: 'm',
    jobs,
    lines,
    choices: {
      j1: { mode: 'line', lineKey: 'l1', useNewQty: false },
      j2: { mode: 'line', lineKey: 'l2', useNewQty: false },
      j3: { mode: 'line', lineKey: 'seed:s9', useNewQty: false },
    },
    newJobKeys: ['l4', 'l2'],
  })
  expect(plan.moves[0]).toEqual({ jobId: 'j1', copyFromBoqId: 'old1' })
  expect(plan.moves[1]).toEqual({ jobId: 'j2', targetBoqId: 'l2', acceptNewQty: false })
  expect(plan.moves[2]).toEqual({ jobId: 'j3', copyFromBoqId: 's9', acceptNewQty: false })
  // l2 is already used by j2, so only l4 gets a new job
  expect(plan.newJobs).toEqual([{ boqId: 'l4' }])

  const approved = buildPlan({
    plotId: 'p',
    newHouseModelId: 'm',
    jobs,
    lines,
    choices: { j1: { mode: 'line', lineKey: 'l1', useNewQty: true } },
    newJobKeys: [],
  })
  expect(approved.moves[0]).toEqual({ jobId: 'j1', targetBoqId: 'l1', acceptNewQty: true })
})
