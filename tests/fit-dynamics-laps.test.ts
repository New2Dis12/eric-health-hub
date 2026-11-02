import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Encoder, Profile, type LapMesg, type RecordMesg } from '@garmin/fitsdk'
import { decodeGarminFitArchive } from '../lib/fit-activity'

function decodeAvailableFit(...args: Parameters<typeof decodeGarminFitArchive>) {
  const result = decodeGarminFitArchive(...args)
  assert.ok(result.available)
  return result
}
import { nativeWorkoutFit, rawDynamicsFit, zipFile, workoutFit } from './fixtures'

const dynamicsColumns = [
  'groundContactTimeMs', 'verticalOscillationCm', 'groundContactTimeBalancePercent',
  'verticalRatioPercent', 'stepLengthCm', 'groundContactTimePercent',
]
const dynamicsValues = [255.5, 10.14, 47.5, 8.45, 117.13, 34.25]
const lapDynamics = {
  avgGroundContactTimeMs: 255.5, avgVerticalOscillationCm: 10.14,
  avgGroundContactTimeBalancePercent: 47.5, avgVerticalRatioPercent: 8.45,
  avgStepLengthCm: 117.13, avgGroundContactTimePercent: 34.25,
}

test('raw FIT integers use native scales exactly once, and mm convert to cm', () => {
  const fit = decodeAvailableFit(rawDynamicsFit(), 1, 10)
  assert.deepEqual(fit.columns?.slice(8), dynamicsColumns)
  assert.deepEqual(fit.samples?.[0].slice(8), dynamicsValues)
  for (const [field, value] of Object.entries(lapDynamics)) {
    assert.equal(fit.laps?.[0][field as keyof typeof lapDynamics], value)
  }
})

test('raw FIT invalid sentinels remain null in samples and laps, never zero', () => {
  const fit = decodeAvailableFit(rawDynamicsFit(true), 1, 10)
  assert.deepEqual(fit.samples?.[0].slice(8), Array(6).fill(null))
  for (const field of Object.keys(lapDynamics)) {
    assert.equal(fit.laps?.[0][field as keyof typeof lapDynamics], null)
  }
})

test('SDK-encoded native running records preserve sparse dynamics on sample pages', () => {
  const fit = zipFile(nativeWorkoutFit())
  const page1 = decodeAvailableFit(fit, 1, 3)
  assert.deepEqual(page1.samples?.[0].slice(8), dynamicsValues)
  assert.deepEqual(page1.samples?.[2].slice(8), Array(6).fill(null))
  assert.equal(page1.nextStartSeconds, 3)
  const page2 = decodeAvailableFit(fit, 1, 3, page1.nextStartSeconds!)
  assert.equal(page2.samples?.[0][1], 3)
  assert.deepEqual(page2.samples?.[0].slice(8), dynamicsValues)
})

test('native laps keep exact timestamps, paused duration, partial distance and summaries', () => {
  const fit = decodeAvailableFit(nativeWorkoutFit(), 300, 1, 1000)
  assert.equal(fit.fitLapCount, 4)
  const lap = fit.laps![0]
  assert.deepEqual(lap, {
    lapIndex: 0, messageIndex: 0,
    startTimestampUtc: '2026-10-27T18:52:01.000Z',
    endTimestampUtc: '2026-10-27T19:00:35.000Z',
    elapsedSeconds: 514, timerSeconds: 510.25, distanceMeters: 1609.34,
    avgHeartRateBpm: 166, maxHeartRateBpm: 182,
    avgSpeedMetersPerSecond: 3.2, maxSpeedMetersPerSecond: 3.6,
    avgPaceSecondsPerKm: 313, bestPaceSecondsPerKm: 278,
    avgCadenceCyclesPerMinute: 80.6484375, maxCadenceCyclesPerMinute: 84.25,
    avgPowerWatts: 250, maxPowerWatts: 310, ...lapDynamics,
  })
  // End timestamp is natively second precision; timer/elapsed have ms precision.
  assert.equal(fit.laps![3].endTimestampUtc, '2026-10-27T19:18:33.000Z')
  assert.equal(fit.laps![3].elapsedSeconds, 50.021)
  assert.equal(fit.laps![3].distanceMeters, 177.73)
  assert.equal(fit.laps![1].avgSpeedMetersPerSecond, 3.144) // legacy fallback
  assert.equal(fit.laps![1].avgPaceSecondsPerKm, 318)
  const differentSampling = decodeAvailableFit(nativeWorkoutFit(), 1, 1000)
  assert.deepEqual(fit.laps, differentSampling.laps)
})

test('independent lap pagination retrieves all native laps, including repeated timestamps/indices', () => {
  const encoder = new Encoder()
  for (let i = 0; i < 205; i++) {
    encoder.onMesg(Profile.MesgNum.LAP, {
      messageIndex: 0, startTime: new Date('2026-10-27T18:52:01Z'),
      timestamp: new Date('2026-10-27T18:52:01Z'), totalDistance: i,
    } as LapMesg)
  }
  const bytes = Buffer.from(encoder.close())
  const laps = []
  let offset = 0
  do {
    const page = decodeAvailableFit(bytes, 1, 1, 0, offset)
    assert.equal(page.fitLapCount, 205)
    assert.ok(page.laps!.length <= 100)
    laps.push(...page.laps!)
    if (!page.lapsTruncated) break
    assert.ok(page.nextLapStartIndex! > offset)
    offset = page.nextLapStartIndex!
  } while (true)
  assert.deepEqual(laps.map(l => l.distanceMeters), Array.from({ length: 205 }, (_, i) => i))
  const beyond = decodeAvailableFit(bytes, 1, 1, 0, 1000)
  assert.deepEqual(beyond.laps, [])
  assert.equal(beyond.nextLapStartIndex, null)
  assert.equal(beyond.lapsTruncated, false)
})

test('lap-only and timestamp-free telemetry files still expose native lap data', () => {
  const fit = decodeAvailableFit(nativeWorkoutFit({ sampleCount: 0 }), 1, 10)
  assert.equal(fit.available, true)
  assert.equal(fit.telemetryAvailable, false)
  assert.equal(fit.startTimestamp, null)
  assert.deepEqual(fit.samples, [])
  assert.equal(fit.fitLapCount, 4)
  const encoder = new Encoder()
  encoder.onMesg(Profile.MesgNum.RECORD, { heartRate: 140 } as RecordMesg)
  encoder.onMesg(Profile.MesgNum.LAP, { totalTimerTime: 30 } as LapMesg)
  const partial = decodeAvailableFit(Buffer.from(encoder.close()), 1, 10)
  assert.equal(partial.available, true)
  assert.equal(partial.telemetryAvailable, false)
  assert.equal(partial.laps![0].startTimestampUtc, null)
  assert.equal(partial.laps![0].endTimestampUtc, null)
  assert.equal(partial.laps![0].timerSeconds, 30)
  assert.equal(partial.laps![0].avgSpeedMetersPerSecond, null)
})

for (const sport of ['cycling', 'training', 'rowing']) {
  test(`${sport} preserves sensor data and uses null for absent running dynamics`, () => {
    const fit = decodeAvailableFit(nativeWorkoutFit({ sport, dynamics: false, sampleCount: 5 }), 1, 10)
    assert.deepEqual(fit.samples![0].slice(2, 8), [160, 3.14, 80.5, 250, 0, 318])
    assert.deepEqual(fit.samples![0].slice(8), Array(6).fill(null))
    assert.equal(fit.laps![0].avgCadenceCyclesPerMinute, 80.6484375)
    for (const field of Object.keys(lapDynamics)) {
      assert.equal(fit.laps![0][field as keyof typeof lapDynamics], null)
    }
  })
}

test('zero values remain zero, stopped pace and fractional-only cadence are null', () => {
  const encoder = new Encoder()
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: new Date('2026-10-27T18:52:01Z'), stanceTime: 0,
    verticalOscillation: 0, stanceTimeBalance: 0, verticalRatio: 0,
    stepLength: 0, stanceTimePercent: 0,
  } as RecordMesg)
  encoder.onMesg(Profile.MesgNum.LAP, {
    totalDistance: 0, avgSpeed: 0, maxSpeed: 0,
    avgCadence: 0, maxFractionalCadence: 0.5,
    avgStanceTime: 0, avgVerticalOscillation: 0,
    avgStanceTimeBalance: 0, avgVerticalRatio: 0, avgStepLength: 0, avgStanceTimePercent: 0,
  } as LapMesg)
  const fit = decodeAvailableFit(Buffer.from(encoder.close()), 1, 10)
  assert.deepEqual(fit.samples![0].slice(8), Array(6).fill(0))
  assert.equal(fit.laps![0].distanceMeters, 0)
  assert.equal(fit.laps![0].avgPaceSecondsPerKm, null)
  assert.equal(fit.laps![0].bestPaceSecondsPerKm, null)
  assert.equal(fit.laps![0].avgCadenceCyclesPerMinute, 0)
  assert.equal(fit.laps![0].maxCadenceCyclesPerMinute, null)
  for (const field of Object.keys(lapDynamics)) {
    assert.equal(fit.laps![0][field as keyof typeof lapDynamics], 0)
  }
})

test('legacy telemetry columns and sample paging are preserved for files without laps', () => {
  const fit = decodeAvailableFit(workoutFit(), 2, 2)
  assert.deepEqual(fit.columns!.slice(0, 8), [
    'timestampUtc', 'elapsedSeconds', 'heartRateBpm', 'speedMetersPerSecond',
    'cadenceCyclesPerMinute', 'powerWatts', 'distanceMeters', 'paceSecondsPerKm',
  ])
  assert.deepEqual(fit.samples![0].slice(0, 8), ['2026-10-30T12:00:00.000Z', 0, 140, 2.5, 80.5, 200, 0, 400])
  assert.equal(fit.nextStartSeconds, 4)
  assert.equal(fit.fitLapCount, 0)
  assert.deepEqual(fit.laps, [])
  assert.equal(fit.nextLapStartIndex, null)
})

test('maximum sample/lap responses stay below the existing MCP byte cap', () => {
  const fit = nativeWorkoutFit({ sampleCount: 2001, lapCount: 101 })
  const page = decodeAvailableFit(fit, 1, 2000)
  assert.equal(page.samples!.length, 2000)
  assert.equal(page.nextStartSeconds, 2000)
  assert.ok(page.laps!.length > 0 && page.laps!.length <= 100)
  assert.equal(page.lapsTruncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify({ activityId: 24873396780, ...page })) < 512 * 1024)
  const next = decodeAvailableFit(fit, 1, 2000, page.nextStartSeconds!, page.nextLapStartIndex!)
  assert.equal(next.samples!.length, 1)
  assert.equal(next.laps!.length, 101 - page.laps!.length)
  assert.equal(next.lapsTruncated, false)
})

test('validates lap page bounds independently of MCP', () => {
  for (const [start, max] of [[-1, 10], [0.5, 10], [Number.MAX_SAFE_INTEGER + 1, 10], [0, 0], [0, 101]]) {
    assert.throws(() => decodeGarminFitArchive(rawDynamicsFit(), 1, 10, 0, start, max), /options/)
  }
})
