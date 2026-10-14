// A minimal ZIP writer for the payslip download: "stored" entries (payslips are PDFs and images that are already
// compressed), UTF-8 file names (Hebrew), each entry written as soon as its bytes are known so the response can stream
// and nothing but one file is ever held in memory. Pure (no imports): scripts/check-payslips.mjs runs this very file and
// opens its output with a real unzip.

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date and time, which is what a zip entry stores (local time, two-second steps, from 1980). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** A file name that is safe inside an archive: no path separators, no control characters, never empty. */
export function safeEntryName(name: string, fallback: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean || fallback
}

/** Gives every name in the list a unique one ("a.pdf", "a (2).pdf", …), keeping the extension. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    if (count === 1) return name
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`
  })
}

type Entry = { name: Uint8Array; crc: number; size: number; offset: number }

/** Streams a zip: `files` is read one at a time, so only the file being written is in memory. */
export function zipStream(files: AsyncIterable<{ name: string; data: Uint8Array }>, now: Date = new Date()): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const stamp = dosDateTime(now)
  const entries: Entry[] = []
  let offset = 0
  const iterator = files[Symbol.asyncIterator]()

  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true)
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value >>> 0, true)

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (!next.done) {
        const { name, data } = next.value
        const nameBytes = encoder.encode(name)
        const crc = crc32(data)
        const header = new Uint8Array(30 + nameBytes.length)
        const view = new DataView(header.buffer)
        u32(view, 0, 0x04034b50)
        u16(view, 4, 20) // needs version 2.0
        u16(view, 6, 0x0800) // names are UTF-8
        u16(view, 8, 0) // stored
        u16(view, 10, stamp.time)
        u16(view, 12, stamp.date)
        u32(view, 14, crc)
        u32(view, 18, data.length)
        u32(view, 22, data.length)
        u16(view, 26, nameBytes.length)
        u16(view, 28, 0)
        header.set(nameBytes, 30)
        entries.push({ name: nameBytes, crc, size: data.length, offset })
        offset += header.length + data.length
        controller.enqueue(header)
        controller.enqueue(data)
        return
      }
      // No more files: the central directory, then the end record.
      const directoryStart = offset
      let directorySize = 0
      for (const entry of entries) {
        const record = new Uint8Array(46 + entry.name.length)
        const view = new DataView(record.buffer)
        u32(view, 0, 0x02014b50)
        u16(view, 4, 20)
        u16(view, 6, 20)
        u16(view, 8, 0x0800)
        u16(view, 10, 0)
        u16(view, 12, stamp.time)
        u16(view, 14, stamp.date)
        u32(view, 16, entry.crc)
        u32(view, 20, entry.size)
        u32(view, 24, entry.size)
        u16(view, 28, entry.name.length)
        u16(view, 30, 0)
        u16(view, 32, 0)
        u16(view, 34, 0)
        u16(view, 36, 0)
        u32(view, 38, 0)
        u32(view, 42, entry.offset)
        record.set(entry.name, 46)
        directorySize += record.length
        controller.enqueue(record)
      }
      const end = new Uint8Array(22)
      const view = new DataView(end.buffer)
      u32(view, 0, 0x06054b50)
      u16(view, 4, 0)
      u16(view, 6, 0)
      u16(view, 8, entries.length)
      u16(view, 10, entries.length)
      u32(view, 12, directorySize)
      u32(view, 16, directoryStart)
      u16(view, 20, 0)
      controller.enqueue(end)
      controller.close()
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
