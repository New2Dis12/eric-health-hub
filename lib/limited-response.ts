import 'server-only'

// Count actual streamed bytes, including decompressed HTTP bodies. Do not trust
// Content-Length alone or buffer an unbounded response with arrayBuffer().
export async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'))
  if (length > maxBytes) {
    await response.body?.cancel()
    throw new Error('Garmin response exceeds the size limit')
  }
  if (!response.body) throw new Error('Garmin returned an empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('Garmin response exceeds the size limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  if (size === 0) throw new Error('Garmin returned an empty response')
  return Buffer.concat(chunks, size)
}
