import { CrcCalculator, Encoder, Profile, type FileIdMesg, type RecordMesg } from '@garmin/fitsdk'
import { deflateRawSync } from 'node:zlib'

// Synthetic workout, no personal data. SDK encoder supplies real FIT framing,
// scales, invalid-value sentinels, and CRCs; assertions use known SI values.
export function workoutFit() {
  const encoder = new Encoder()
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin' } as FileIdMesg)
  for (let i = 0; i < 5; i++) {
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(Date.UTC(2026, 9, 30, 12, 0, i)),
      ...(i === 2 ? {} : { heartRate: 140 + i, cadence: 80, fractionalCadence: 0.5, power: 200 + i }),
      speed: i === 4 ? 0 : 2.5,
      ...(i === 1 ? { enhancedSpeed: 4 } : {}),
      distance: i * 2.5,
    } as RecordMesg)
  }
  return Buffer.from(encoder.close())
}

export function zipFile(data: Buffer, { name = 'workout.FIT', method = 8, descriptor = false } = {}) {
  const nameBytes = Buffer.from(name)
  const compressed = method === 0 ? data : deflateRawSync(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50)
  local.writeUInt16LE(descriptor ? 8 : 0, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(descriptor ? 0 : compressed.length, 18)
  local.writeUInt32LE(descriptor ? 0 : data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50)
  central.writeUInt16LE(descriptor ? 8 : 0, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  const directoryOffset = local.length + nameBytes.length + compressed.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBytes.length, 12)
  end.writeUInt32LE(directoryOffset, 16)
  return Buffer.concat([local, nameBytes, compressed, central, nameBytes, end])
}

// A 5 km run with three mile laps and a short finishing lap. Lap boundaries
// deliberately do not match sample pages or everySeconds. Also reused for
// cycling/strength/rowing fixtures without inventing running measurements.
export function nativeWorkoutFit({
  lapCount = 4, sampleCount = 1591, sport = 'running', dynamics = true,
} = {}) {
  const encoder = new Encoder()
  const start = Date.UTC(2026, 9, 27, 18, 52, 1)
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin' } as FileIdMesg)
  for (let i = 0; i < sampleCount; i++) {
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(start + (i + 2) * 1000),
      heartRate: 160 + i % 20, cadence: 80, fractionalCadence: 0.5,
      speed: 3.144, power: 250, distance: i * 3.144,
      ...(dynamics && i !== 2 ? {
        stanceTime: 255.5, verticalOscillation: 101.4, stanceTimeBalance: 47.5,
        verticalRatio: 8.45, stepLength: 1171.3, stanceTimePercent: 34.25,
      } : {}),
    } as RecordMesg)
  }
  for (let i = 0; i < lapCount; i++) {
    const partial = i === 3
    encoder.onMesg(Profile.MesgNum.LAP, {
      messageIndex: i, sport,
      startTime: new Date(start + i * 514_000),
      timestamp: new Date(start + (i * 514 + (partial ? 50 : 514)) * 1000),
      totalElapsedTime: partial ? 50.021 : 514,
      totalTimerTime: partial ? 50.021 : 510.25, // preserve pauses independently
      totalDistance: partial ? 177.73 : 1609.34,
      avgHeartRate: 166, maxHeartRate: 182,
      avgSpeed: partial ? 3.553 : 3.144, maxSpeed: 3.527,
      ...(i === 0 ? { enhancedAvgSpeed: 3.2, enhancedMaxSpeed: 3.6 } : {}),
      avgCadence: 80, avgFractionalCadence: 0.6484375,
      maxCadence: 84, maxFractionalCadence: 0.25,
      avgPower: 250, maxPower: 310,
      ...(dynamics ? {
        avgStanceTime: 255.5, avgVerticalOscillation: 101.4,
        avgStanceTimeBalance: 47.5, avgVerticalRatio: 8.45,
        avgStepLength: 1171.3, avgStanceTimePercent: 34.25,
      } : {}),
    } as import('@garmin/fitsdk').LapMesg)
  }
  return Buffer.from(encoder.close())
}

// Hand-encoded raw integer payloads make unit tests independent of Garmin's
// Encoder scaling. Field numbers/scales are from FIT Profile 21.218 record/lap.
export function rawDynamicsFit(invalid = false) {
  const pieces: Buffer[] = []
  const timestamp = Math.floor((Date.UTC(2026, 9, 27, 18, 52, 1) - Date.UTC(1989, 11, 31)) / 1000)
  function message(local: number, global: number, fields: [number, number, number, number][]) {
    const definition = Buffer.alloc(6 + fields.length * 3)
    definition[0] = 0x40 | local
    definition.writeUInt16LE(global, 3) // little endian
    definition[5] = fields.length
    const data = Buffer.alloc(1 + fields.reduce((n, f) => n + f[1], 0))
    data[0] = local
    let offset = 1
    fields.forEach(([number, size, base, value], i) => {
      definition.set([number, size, base], 6 + i * 3)
      data.writeUIntLE(value, offset, size)
      offset += size
    })
    pieces.push(definition, data)
  }
  const u16 = (value: number) => invalid ? 0xffff : value
  message(0, 20, [
    [253, 4, 0x86, timestamp],
    [39, 2, 0x84, u16(1014)], // oscillation 101.4 mm -> 10.14 cm
    [40, 2, 0x84, u16(3425)], // contact percent 34.25%
    [41, 2, 0x84, u16(2555)], // contact time 255.5 ms
    [83, 2, 0x84, u16(845)], // vertical ratio 8.45%
    [84, 2, 0x84, u16(4750)], // balance 47.50%
    [85, 2, 0x84, u16(11713)], // step length 1171.3 mm -> 117.13 cm
  ])
  message(1, 19, [
    [253, 4, 0x86, timestamp + 50], [2, 4, 0x86, timestamp],
    [77, 2, 0x84, u16(1014)], [78, 2, 0x84, u16(3425)],
    [79, 2, 0x84, u16(2555)], [118, 2, 0x84, u16(845)],
    [119, 2, 0x84, u16(4750)], [120, 2, 0x84, u16(11713)],
  ])
  const header = Buffer.alloc(12)
  header[0] = 12
  header[1] = 0x20
  header.writeUInt16LE(21218, 2)
  header.writeUInt32LE(pieces.reduce((n, p) => n + p.length, 0), 4)
  header.write('.FIT', 8, 'ascii')
  const content = Buffer.concat([header, ...pieces])
  const crc = Buffer.alloc(2)
  crc.writeUInt16LE(CrcCalculator.calculateCRC(content, 0, content.length))
  return Buffer.concat([content, crc])
}
