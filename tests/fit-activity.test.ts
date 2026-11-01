import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Encoder, Profile, CrcCalculator, type FileIdMesg } from '@garmin/fitsdk'
import { decodeGarminFitArchive } from '../lib/fit-activity'
import { workoutFit, zipFile } from './fixtures'

for (const method of [0, 8]) {
  test(`decodes ${method === 0 ? 'stored' : 'deflated'} FIT ZIP and exact metric units`, () => {
    const result = decodeGarminFitArchive(zipFile(workoutFit(), { method, descriptor: true }), 1, 1000)
    assert.equal(result.available, true)
    assert.equal(result.fitRecordCount, 5)
    assert.deepEqual(result.samples?.[0], ['2026-10-30T12:00:00.000Z', 0, 140, 2.5, 80.5, 200, 0, 400])
    assert.equal(result.samples?.[1][3], 4) // enhanced speed preferred
    assert.deepEqual(result.samples?.[2].slice(2), [null, 2.5, null, null, 5, 400])
    assert.equal(result.samples?.[4][7], null) // no infinite pace when stopped
    assert.equal(result.truncated, false)
  })
}

test('raw FIT, downsampling, and pagination preserve timestamps without gaps', () => {
  const fit = workoutFit()
  const page1 = decodeGarminFitArchive(fit, 2, 2)
  assert.deepEqual(page1.samples?.map(s => s[1]), [0, 2])
  assert.equal(page1.truncated, true)
  assert.equal(page1.nextStartSeconds, 4)
  const page2 = decodeGarminFitArchive(fit, 2, 2, page1.nextStartSeconds!)
  assert.deepEqual(page2.samples?.map(s => s[1]), [4])
  assert.equal(page2.truncated, false)
  assert.deepEqual(decodeGarminFitArchive(fit, 1, 10, 50).samples, [])
})

test('no FIT and FIT without records report unavailability', () => {
  assert.equal(decodeGarminFitArchive(zipFile(Buffer.from('tcx'), { name: 'workout.tcx' }), 1, 100).available, false)
  const encoder = new Encoder()
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity' } as FileIdMesg)
  assert.equal(decodeGarminFitArchive(Buffer.from(encoder.close()), 1, 100).available, false)
})

test('rejects corrupt, truncated, oversized, encrypted and unsupported archives', () => {
  const fit = workoutFit()
  const corrupt = Buffer.from(fit); corrupt[20] ^= 1
  assert.throws(() => decodeGarminFitArchive(corrupt, 1, 100), /integrity/)
  const zip = zipFile(fit)
  assert.throws(() => decodeGarminFitArchive(zip.subarray(0, zip.length - 10), 1, 100), /ZIP/)
  assert.throws(() => decodeGarminFitArchive(Buffer.alloc(16 * 1024 * 1024 + 1), 1, 100), /large/)
  const central = zip.readUInt32LE(zip.length - 6)
  const bomb = Buffer.from(zip); bomb.writeUInt32LE(17 * 1024 * 1024, central + 24)
  assert.throws(() => decodeGarminFitArchive(bomb, 1, 100), /large/)
  const encrypted = Buffer.from(zip); encrypted.writeUInt16LE(1, central + 8)
  assert.throws(() => decodeGarminFitArchive(encrypted, 1, 100), /Unsupported/)
  assert.throws(() => decodeGarminFitArchive(zipFile(fit, { method: 99 }), 1, 100), /compression/)
})

test('rejects decompression bombs even with false directory sizes', () => {
  const zip = zipFile(Buffer.alloc(17 * 1024 * 1024))
  const central = zip.readUInt32LE(zip.length - 6)
  zip.writeUInt32LE(10, central + 24)
  assert.throws(() => decodeGarminFitArchive(zip, 1, 100))
})

test('does not return partial data when SDK reports decode errors after valid CRC', () => {
  const fit = workoutFit()
  // Invalid first definition-message base type, then repair file CRC.
  fit[22] = 0x1f
  fit.writeUInt16LE(CrcCalculator.calculateCRC(fit, 0, fit.length - 2), fit.length - 2)
  assert.throws(() => decodeGarminFitArchive(fit, 1, 100))
})

test('validates sampling bounds independently of MCP', () => {
  for (const [interval, count, start] of [[0, 100, 0], [1, 2001, 0], [1, 1, -1]]) {
    assert.throws(() => decodeGarminFitArchive(workoutFit(), interval, count, start), /options/)
  }
})

test('records without timestamps report unavailability', () => {
  const encoder = new Encoder()
  encoder.onMesg(Profile.MesgNum.RECORD, { heartRate: 120 } as import('@garmin/fitsdk').RecordMesg)
  const result = decodeGarminFitArchive(Buffer.from(encoder.close()), 1, 100)
  assert.equal(result.available, false)
  assert.match(result.reason!, /timestamps/)
})

test('bounds decoded message count even when the FIT file is small', () => {
  const encoder = new Encoder()
  for (let i = 0; i < 200_001; i++) {
    encoder.onMesg(Profile.MesgNum.RECORD, { heartRate: 120 } as import('@garmin/fitsdk').RecordMesg)
  }
  assert.throws(() => decodeGarminFitArchive(Buffer.from(encoder.close()), 1, 1), /decoding/)
})
