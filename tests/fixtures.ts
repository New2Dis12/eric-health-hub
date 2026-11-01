import { Encoder, Profile, type FileIdMesg, type RecordMesg } from '@garmin/fitsdk'
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
