import { api } from './api'
import { env } from './env'
import { sha256Hex, type Purpose } from './image'

export interface Ticket { ticketId: string | number; path: string; expiresAt?: string }
export interface Prepared { blob: Blob; width: number; height: number }

export async function requestTicket(purpose: Purpose, p: Prepared): Promise<Ticket> {
  const sha256 = await sha256Hex(p.blob)
  const t = await api<Record<string, unknown>>('/media/tickets', { method: 'POST', body: { purpose, bytes: p.blob.size, width: p.width, height: p.height, sha256, contentType: 'image/webp' } })
  return { ticketId: (t.ticketId ?? t.id) as string | number, path: (t.path ?? t.objectPath ?? t.publicId ?? t.key) as string, expiresAt: t.expiresAt as string | undefined }
}

/** Subida directa al storage con progreso real (XHR). */
export function uploadToStorage(path: string, blob: Blob, onProgress: (pct: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const isCloud = env.provider === 'cloudinary'
    let body: Blob | FormData = blob
    if (isCloud) {
      const fd = new FormData(); fd.append('file', blob); fd.append('upload_preset', env.preset); fd.append('public_id', path); body = fd
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${env.cloudName}/image/upload`)
    } else {
      xhr.open('POST', `${env.supabaseUrl}/storage/v1/object/${env.supabaseBucket}/${path}`)
      xhr.setRequestHeader('apikey', env.supabaseKey)
      xhr.setRequestHeader('Authorization', `Bearer ${env.supabaseKey}`)
      xhr.setRequestHeader('Content-Type', 'image/webp')
      xhr.setRequestHeader('x-upsert', 'false')
    }
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (isCloud) { try { resolve((JSON.parse(xhr.responseText) as { secure_url: string }).secure_url) } catch { reject(new Error('Respuesta inválida del storage.')) } }
        else resolve(`${env.supabaseUrl}/storage/v1/object/public/${env.supabaseBucket}/${path}`)
      } else reject(new Error(`El storage rechazó la subida (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error('Falló la conexión con el storage.'))
    xhr.onabort = () => reject(new DOMException('Cancelado', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

export async function confirmTicket(id: string | number, url: string): Promise<number> {
  const r = await api<{ mediaId?: number; id?: number }>(`/media/tickets/${id}/confirm`, { method: 'POST', body: { url } })
  return (r.mediaId ?? r.id) as number
}

/** Flujo completo con un solo ticket por intento de subida. */
export async function uploadImage(purpose: Purpose, p: Prepared, onProgress: (n: number) => void, signal: AbortSignal): Promise<number> {
  const t = await requestTicket(purpose, p)
  const url = await uploadToStorage(t.path, p.blob, onProgress, signal)
  return confirmTicket(t.ticketId, url)
}
