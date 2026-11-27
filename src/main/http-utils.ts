import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export async function readJsonBody<T>(request: IncomingMessage, limit = 2 * 1024 * 1024): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    request.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) {
        reject(new HttpError(413, 'Request is too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(JSON.parse(raw) as T)
      } catch {
        reject(new HttpError(400, 'Invalid JSON body.'))
      }
    })
    request.on('error', (error) => reject(error))
  })
}

export function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown
): void {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

export function safeRelativePath(value: string | null): string | null {
  if (!value) return null
  if (value.includes('\0') || value.includes('\\') || value.startsWith('/')) return null
  const segments = value.split('/')
  if (segments.length === 0) return null
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return null
    if (segment.length > 255) return null
    if (/[<>:"|?*]/.test(segment)) return null
    if (segment.endsWith('.') || segment.endsWith(' ')) return null
  }
  return segments.join('/')
}

export function safeFolderName(value: string): string | null {
  if (!value || value.startsWith('.') || value.length > 200) return null
  if (/[/\\<>:"|?*\0]/.test(value)) return null
  if (value === '.' || value === '..') return null
  if (value.endsWith('.') || value.endsWith(' ')) return null
  return value
}
