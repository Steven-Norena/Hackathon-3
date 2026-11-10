export type Purpose = 'BADGE' | 'INCIDENT'
export const LIMITS: Record<Purpose, number> = { BADGE: 120 * 1024, INCIDENT: 300 * 1024 }

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.')
  return createImageBitmap(file)
}

function toBlob(canvas: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen.'))), 'image/webp', q))
}

/** Dibuja en canvas (esto descarta EXIF/XMP/ubicación) y exporta WebP bajo el límite de peso. */
async function encode(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, max: number, shrink: boolean) {
  let cw = w, ch = h
  for (let round = 0; round < 6; round++) {
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Tu navegador no puede procesar imágenes.')
    draw(ctx, cw, ch)
    for (let q = 0.92; q >= 0.3; q -= 0.12) {
      const b = await toBlob(canvas, q)
      if (b.type !== 'image/webp') throw new Error('Tu navegador no puede generar WebP. Prueba con Chrome, Edge o Firefox actualizados.')
      if (b.size <= max) return { blob: b, width: cw, height: ch }
    }
    if (!shrink) break
    cw = Math.round(cw * 0.85); ch = Math.round(ch * 0.85)
  }
  throw new Error('No se pudo reducir la imagen al peso permitido.')
}

export async function cropBadge(bmp: ImageBitmap, sx: number, sy: number, side: number) {
  return encode((ctx, w, h) => ctx.drawImage(bmp, sx, sy, side, side, 0, 0, w, h), 512, 512, LIMITS.BADGE, false)
}

export async function fitIncident(bmp: ImageBitmap) {
  const long = Math.max(bmp.width, bmp.height)
  const target = Math.min(1600, Math.max(800, long))
  const k = target / long
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
  // Si hay que reducir más por peso, el lado mayor no baja de 800.
  for (let t = target; t >= 800; t = Math.floor(t * 0.88)) {
    const kk = t / long
    const ww = Math.round(bmp.width * kk), hh = Math.round(bmp.height * kk)
    try { return await encode((ctx, cw, ch) => ctx.drawImage(bmp, 0, 0, cw, ch), ww, hh, LIMITS.INCIDENT, false) } catch (e) { if (t <= 800) throw e }
  }
  return encode((ctx, cw, ch) => ctx.drawImage(bmp, 0, 0, cw, ch), w, h, LIMITS.INCIDENT, false)
}

export async function sha256Hex(b: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
