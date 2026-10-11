// A one-page PDF around a JPEG, written by hand (no library). The poster is drawn
// in the brand's own look and fonts on a canvas, then placed full-bleed on the page,
// so the PDF looks exactly like the picture does.
//
// The file is the five objects a viewer needs: catalog, page tree, page, the image
// (DCTDecode = a JPEG stream, passed through untouched) and the one-line drawing
// instruction that paints it. Pure: bytes in, bytes out.

const encoder = new TextEncoder()

/** A UTF-16BE hex string, which is how a PDF stores a non-ASCII title. */
function pdfText(value: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex}>`
}

/** `jpeg` is the finished JPEG file; `width`/`height` are its pixel size. The page is A4-wide and as tall as the picture needs. */
export function pdfFromJpeg(jpeg: Uint8Array, width: number, height: number, title: string): Uint8Array<ArrayBuffer> {
  const pageW = 595
  const pageH = Math.round((pageW * height) / width)
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (n: number, body: string) => {
    offsets[n] = length
    push(`${n} 0 obj\n${body}\nendobj\n`)
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  offsets[4] = length
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  push(jpeg)
  push('\nendstream\nendobj\n')
  const draw = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`
  object(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
  object(6, `<< /Title ${pdfText(title)} /Producer (Sarcafe) >>`)

  const xref = length
  push(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(new ArrayBuffer(length))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
