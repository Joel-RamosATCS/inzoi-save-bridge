import { createWriteStream, promises as fs } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  MAX_TRANSFER_BYTES,
  MAX_TRANSFER_FILES,
  PROTOCOL
} from '@shared/constants'
import type {
  AppPlatform,
  IncomingRequest,
  IncomingResponse,
  TransferProgress,
  TransferRecord
} from '@shared/types'
import {
  HttpError,
  readJsonBody,
  safeFolderName,
  safeRelativePath,
  sendJson
} from './http-utils'

export interface ReceiverServerInfo {
  app: 'inzoi-save-bridge'
  protocol: number
  instanceId: string
  name: string
  platform: AppPlatform
  port: number
  savesPath: string | null
  version: string
  accepting: boolean
  capabilities?: string[]
}

interface ManifestFile {
  path: string
  size: number
}

interface PreparePayload {
  protocol: number
  transferId: string
  sender: {
    instanceId: string
    name: string
    platform: AppPlatform
  }
  saveNames: string[]
  files: ManifestFile[]
  totalBytes: number
  fileCount: number
  backup: boolean
}

interface TransferSession {
  id: string
  senderName: string
  senderPlatform: AppPlatform
  saveNames: string[]
  files: Map<string, number>
  totalBytes: number
  completedBytes: number
  completedFiles: Set<string>
  activeFiles: Map<string, number>
  createdDirs: Set<string>
  backup: boolean
  destination: string
  tempRoot: string
  createdAt: number
  startedAt: number
  lastEmit: number
}

export interface ReceiverServerOptions {
  info: () => Omit<ReceiverServerInfo, 'port'>
  askBeforeAccepting: () => boolean
  requestAcceptance: (request: IncomingRequest) => Promise<IncomingResponse>
  getDestination: () => Promise<string | null>
  onProgress: (progress: TransferProgress) => void
  onCompleted: (record: TransferRecord) => void
  log: (message: string) => void
}

const MAX_SAVE_FOLDERS = 100

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export class ReceiverServer {
  private server: http.Server | null = null
  private actualPort = 0
  private sessions = new Map<string, TransferSession>()
  private cleanupTimer: NodeJS.Timeout | null = null
  private cleanedDestinations = new Set<string>()

  constructor(private readonly options: ReceiverServerOptions) {}

  get port(): number {
    return this.actualPort
  }

  getInfo(): ReceiverServerInfo {
    return {
      ...this.options.info(),
      port: this.actualPort,
      capabilities: ['batch-v3', 'concurrent-v2', 'retry-safe']
    }
  }

  async start(preferredPort: number): Promise<number> {
    for (let offset = 0; offset < 6; offset += 1) {
      const port = preferredPort + offset
      const server = http.createServer((request, response) => {
        void this.handle(request, response)
      })
      server.on('connection', (socket) => {
        socket.setNoDelay(true)
        socket.setKeepAlive(true, 10_000)
      })
      server.requestTimeout = 0
      server.headersTimeout = 30_000
      server.keepAliveTimeout = 15_000
      const started = await new Promise<boolean>((resolve) => {
        const onError = (): void => {
          server.off('listening', onListening)
          resolve(false)
        }
        const onListening = (): void => {
          server.off('error', onError)
          resolve(true)
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '0.0.0.0')
      })
      if (started) {
        this.server = server
        this.actualPort = port
        server.on('error', (error) => this.options.log(`Receiver error: ${error.message}`))
        this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), 60_000)
        return port
      }
      server.close()
    }
    throw new Error('Could not open a local transfer port.')
  }

  stop(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.cleanupTimer = null
    this.server?.close()
    this.server = null
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-InZOI-Bridge-Protocol', String(PROTOCOL))
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = request.method ?? 'GET'

      if (method === 'GET' && url.pathname === '/api/info') {
        sendJson(response, 200, this.getInfo())
        return
      }

      if (method === 'POST' && url.pathname === '/api/prepare') {
        const payload = await readJsonBody<PreparePayload>(request)
        const result = await this.prepare(payload)
        sendJson(response, 200, result)
        return
      }

      const fileMatch = url.pathname.match(/^\/api\/transfer\/([^/]+)\/file$/)
      if (method === 'PUT' && fileMatch) {
        await this.receiveFile(request, response, fileMatch[1], url.searchParams.get('path'))
        return
      }

      const batchMatch = url.pathname.match(/^\/api\/transfer\/([^/]+)\/batch$/)
      if (method === 'POST' && batchMatch) {
        await this.receiveBatch(request, response, batchMatch[1])
        return
      }

      const completeMatch = url.pathname.match(/^\/api\/transfer\/([^/]+)\/complete$/)
      if (method === 'POST' && completeMatch) {
        const result = await this.complete(completeMatch[1])
        sendJson(response, 200, result)
        return
      }

      const abortMatch = url.pathname.match(/^\/api\/transfer\/([^/]+)\/abort$/)
      if (method === 'POST' && abortMatch) {
        await this.abort(abortMatch[1])
        sendJson(response, 200, { ok: true })
        return
      }

      sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      if (error instanceof HttpError) {
        if (!response.headersSent) sendJson(response, error.status, { error: error.message })
        return
      }
      this.options.log(`Receiver request failed: ${(error as Error).message}`)
      if (!response.headersSent) {
        sendJson(response, 500, { error: (error as Error).message || 'Transfer failed.' })
      }
    }
  }

  private async prepare(payload: PreparePayload): Promise<Record<string, unknown>> {
    if (!payload || payload.protocol !== PROTOCOL) {
      throw new HttpError(400, 'This device is running an incompatible version.')
    }
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(payload.transferId ?? '')) {
      throw new HttpError(400, 'Invalid transfer session.')
    }
    if (this.sessions.has(payload.transferId)) {
      throw new HttpError(409, 'That transfer is already in progress.')
    }
    if (!Array.isArray(payload.saveNames) || payload.saveNames.length === 0) {
      throw new HttpError(400, 'No saves were selected.')
    }
    if (payload.saveNames.length > MAX_SAVE_FOLDERS) {
      throw new HttpError(400, 'Too many save folders in one transfer.')
    }
    const saveNames: string[] = []
    for (const name of payload.saveNames) {
      const safe = safeFolderName(name)
      if (!safe) throw new HttpError(400, 'A save folder has an unsafe name.')
      if (saveNames.includes(safe)) throw new HttpError(400, 'Duplicate save folder.')
      saveNames.push(safe)
    }
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      throw new HttpError(400, 'The save is empty.')
    }
    if (payload.files.length > MAX_TRANSFER_FILES) {
      throw new HttpError(400, 'That transfer contains too many files.')
    }
    const files = new Map<string, number>()
    let totalBytes = 0
    const touchedSaves = new Set<string>()
    for (const file of payload.files) {
      const relative = safeRelativePath(file.path)
      if (!relative) throw new HttpError(400, 'The transfer contains an unsafe file path.')
      const [root] = relative.split('/')
      if (!saveNames.includes(root)) {
        throw new HttpError(400, 'The transfer contains a file outside the selected saves.')
      }
      if (files.has(relative)) throw new HttpError(400, 'The transfer contains duplicate files.')
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new HttpError(400, 'The transfer contains an invalid file size.')
      }
      files.set(relative, file.size)
      totalBytes += file.size
      touchedSaves.add(root)
    }
    if (totalBytes > MAX_TRANSFER_BYTES) {
      throw new HttpError(413, 'That save is too large to transfer.')
    }
    if (totalBytes !== payload.totalBytes || files.size !== payload.fileCount) {
      throw new HttpError(400, 'The transfer manifest does not add up.')
    }
    if (touchedSaves.size !== saveNames.length) {
      throw new HttpError(400, 'A selected save has no files.')
    }

    const destination = await this.options.getDestination()
    if (!destination) {
      throw new HttpError(503, 'No destination save folder is available on this PC.')
    }

    await this.cleanupOrphanTemps(destination)

    const conflicts: string[] = []
    for (const name of saveNames) {
      try {
        await fs.stat(path.join(destination, name))
        conflicts.push(name)
      } catch {
        /* no conflict */
      }
    }

    let backup = Boolean(payload.backup)
    if (this.options.askBeforeAccepting()) {
      const response = await this.options.requestAcceptance({
        requestId: payload.transferId,
        peerName: payload.sender?.name ?? 'Unknown device',
        peerPlatform: payload.sender?.platform ?? 'unknown',
        saveNames,
        totalBytes,
        fileCount: files.size,
        destinationPath: destination,
        backupRequested: backup
      })
      if (!response.accept) {
        throw new HttpError(403, 'The transfer was declined on the destination PC.')
      }
      backup = response.backup
    }

    const session: TransferSession = {
      id: payload.transferId,
      senderName: payload.sender?.name ?? 'Unknown device',
      senderPlatform: payload.sender?.platform ?? 'unknown',
      saveNames,
      files,
      totalBytes,
      completedBytes: 0,
      completedFiles: new Set(),
      activeFiles: new Map(),
      createdDirs: new Set(),
      backup,
      destination,
      tempRoot: path.join(destination, '.inzoi-save-bridge-tmp', payload.transferId),
      createdAt: Date.now(),
      startedAt: Date.now(),
      lastEmit: 0
    }
    this.sessions.set(session.id, session)
    this.emitProgress(session, 'transferring', null, true)

    return {
      ok: true,
      transferId: session.id,
      destinationPath: destination,
      conflicts,
      backup,
      saveNames,
      capabilities: ['batch-v3', 'concurrent-v2', 'retry-safe']
    }
  }

  private sessionFor(id: string): TransferSession {
    const session = this.sessions.get(id)
    if (!session) throw new HttpError(404, 'This transfer has expired.')
    return session
  }

  private async ensureDir(session: TransferSession, dir: string): Promise<void> {
    if (session.createdDirs.has(dir)) return
    await fs.mkdir(dir, { recursive: true })
    session.createdDirs.add(dir)
  }

  private async receiveBatch(
    request: IncomingMessage,
    response: ServerResponse,
    id: string
  ): Promise<void> {
    const session = this.sessionFor(id)
    const maxBatchBytes = 32 * 1024 * 1024
    const batchKey = `__batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    session.activeFiles.set(batchKey, 0)

    const contentLength = Number(request.headers['content-length'])
    let body: Buffer
    try {
      body = await new Promise<Buffer>((resolve, reject) => {
        if (
          Number.isSafeInteger(contentLength) &&
          contentLength > 0 &&
          contentLength <= maxBatchBytes
        ) {
          const slab = Buffer.allocUnsafe(contentLength)
          let writeOffset = 0
          request.on('data', (chunk: Buffer) => {
            if (writeOffset + chunk.length > contentLength) {
              request.destroy(new Error('Batch exceeded declared content-length.'))
              return
            }
            chunk.copy(slab, writeOffset)
            writeOffset += chunk.length
            session.activeFiles.set(batchKey, writeOffset)
            this.emitProgress(session, 'transferring', null)
          })
          request.on('end', () => {
            if (writeOffset !== contentLength) {
              reject(new Error('Batch upload ended early.'))
              return
            }
            resolve(slab)
          })
          request.on('error', reject)
          return
        }

        const chunks: Buffer[] = []
        let total = 0
        request.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBatchBytes) {
            request.destroy(new Error('Batch exceeds maximum size.'))
            return
          }
          session.activeFiles.set(batchKey, total)
          chunks.push(chunk)
          this.emitProgress(session, 'transferring', null)
        })
        request.on('end', () => resolve(Buffer.concat(chunks, total)))
        request.on('error', reject)
      })
    } catch (error) {
      session.activeFiles.delete(batchKey)
      throw new HttpError(400, `Batch upload failed: ${(error as Error).message}`)
    }

    const parsedItems: Array<{ relative: string; target: string; data: Buffer; size: number }> = []
    const dirsToCreate = new Set<string>()
    let offset = 0

    try {
      while (offset < body.length) {
        if (offset + 6 > body.length) {
          throw new HttpError(400, 'Truncated batch frame header.')
        }
        const pathLen = body.readUInt16LE(offset)
        const fileLen = body.readUInt32LE(offset + 2)
        offset += 6
        if (offset + pathLen + fileLen > body.length) {
          throw new HttpError(400, 'Truncated batch frame payload.')
        }
        const rawPath = body.subarray(offset, offset + pathLen).toString('utf8')
        offset += pathLen
        const data = body.subarray(offset, offset + fileLen)
        offset += fileLen

        const relative = safeRelativePath(rawPath)
        if (!relative) throw new HttpError(400, 'Unsafe path in batch.')
        const expectedSize = session.files.get(relative)
        if (expectedSize === undefined || expectedSize !== fileLen) {
          throw new HttpError(400, 'Batch file size does not match manifest.')
        }
        if (session.completedFiles.has(relative)) continue

        const target = path.join(session.tempRoot, ...relative.split('/'))
        const dir = path.dirname(target)
        if (!session.createdDirs.has(dir)) {
          dirsToCreate.add(dir)
        }
        parsedItems.push({ relative, target, data, size: fileLen })
      }

      for (const dir of dirsToCreate) {
        await this.ensureDir(session, dir)
      }

      const writeConcurrency = 16
      for (let i = 0; i < parsedItems.length; i += writeConcurrency) {
        const slice = parsedItems.slice(i, i + writeConcurrency)
        await Promise.all(slice.map((item) => fs.writeFile(item.target, item.data)))
      }

      let lastRel: string | null = null
      for (const item of parsedItems) {
        if (!session.completedFiles.has(item.relative)) {
          session.completedFiles.add(item.relative)
          session.completedBytes += item.size
          lastRel = item.relative
        }
      }
      session.activeFiles.delete(batchKey)
      session.lastEmit = 0
      this.emitProgress(session, 'transferring', lastRel, true)
      sendJson(response, 200, { ok: true, count: parsedItems.length })
    } catch (error) {
      session.activeFiles.delete(batchKey)
      throw error
    }
  }

  private async receiveFile(
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
    rawPath: string | null
  ): Promise<void> {
    const session = this.sessionFor(id)
    const relative = safeRelativePath(rawPath)
    if (!relative) throw new HttpError(400, 'Missing or unsafe file path.')
    const expectedSize = session.files.get(relative)
    if (expectedSize === undefined) throw new HttpError(400, 'That file is not part of this transfer.')
    if (session.completedFiles.has(relative)) {
      request.resume()
      sendJson(response, 200, { ok: true })
      return
    }
    if (session.activeFiles.has(relative)) {
      throw new HttpError(409, 'That file is currently uploading.')
    }

    const contentLength = Number(request.headers['content-length'])
    if (!Number.isSafeInteger(contentLength) || contentLength !== expectedSize) {
      throw new HttpError(400, 'File size does not match the manifest.')
    }

    const target = path.join(session.tempRoot, ...relative.split('/'))
    await this.ensureDir(session, path.dirname(target))
    session.activeFiles.set(relative, 0)

    if (expectedSize <= 512 * 1024) {
      try {
        const buf = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = []
          let fileBytes = 0
          request.on('data', (chunk: Buffer) => {
            fileBytes += chunk.length
            session.activeFiles.set(relative, fileBytes)
            if (fileBytes > expectedSize) {
              request.destroy(new Error('File exceeded its declared size.'))
              return
            }
            chunks.push(chunk)
          })
          request.on('end', () => {
            if (fileBytes !== expectedSize) {
              reject(new Error('Upload ended early.'))
              return
            }
            resolve(Buffer.concat(chunks, fileBytes))
          })
          request.on('error', reject)
        })
        await fs.writeFile(target, buf)
      } catch (error) {
        await fs.rm(target, { force: true }).catch(() => undefined)
        session.activeFiles.delete(relative)
        throw new HttpError(400, `Upload failed: ${(error as Error).message}`)
      }
    } else {
      let fileBytes = 0
      const onData = (chunk: Buffer): void => {
        fileBytes += chunk.length
        session.activeFiles.set(relative, fileBytes)
        if (fileBytes > expectedSize) {
          request.destroy(new Error('File exceeded its declared size.'))
          return
        }
        this.emitProgress(session, 'transferring', relative)
      }
      request.on('data', onData)

      try {
        await pipeline(request, createWriteStream(target, { flags: 'w', highWaterMark: 256 * 1024 }))
        if (fileBytes !== expectedSize) throw new Error('Upload ended early.')
      } catch (error) {
        request.off('data', onData)
        await fs.rm(target, { force: true }).catch(() => undefined)
        session.activeFiles.delete(relative)
        throw new HttpError(400, `Upload failed: ${(error as Error).message}`)
      }
      request.off('data', onData)
    }

    session.completedFiles.add(relative)
    session.completedBytes += expectedSize
    session.activeFiles.delete(relative)
    session.lastEmit = 0
    this.emitProgress(session, 'transferring', relative, true)
    sendJson(response, 200, { ok: true })
  }

  private async complete(id: string): Promise<Record<string, unknown>> {
    const session = this.sessionFor(id)
    if (session.completedFiles.size !== session.files.size) {
      throw new HttpError(400, 'The transfer is not finished yet.')
    }
    this.emitProgress(session, 'finalizing', null, true)

    await fs.mkdir(session.destination, { recursive: true })
    const backupRoot = path.join(session.destination, '.inzoi-save-bridge-backups', nowStamp())
    const replacedRoot = path.join(session.destination, '.inzoi-save-bridge-tmp', `${session.id}-replaced`)
    let usedBackup = false

    for (const name of session.saveNames) {
      const source = path.join(session.tempRoot, name)
      const target = path.join(session.destination, name)
      let restorePath: string | null = null
      try {
        await fs.stat(source)
      } catch {
        throw new HttpError(400, `The upload for ${name} is incomplete.`)
      }

      try {
        await fs.stat(target)
        if (session.backup) {
          restorePath = path.join(backupRoot, name)
          await fs.mkdir(backupRoot, { recursive: true })
          await fs.rename(target, restorePath)
          usedBackup = true
        } else {
          restorePath = path.join(replacedRoot, name)
          await fs.mkdir(replacedRoot, { recursive: true })
          await fs.rename(target, restorePath)
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT') throw error
        restorePath = null
      }

      try {
        await fs.rename(source, target)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EXDEV') {
          await fs.cp(source, target, { recursive: true, errorOnExist: false })
          await fs.rm(source, { recursive: true, force: true })
        } else {
          if (restorePath) {
            await fs.rename(restorePath, target).catch(() => undefined)
          }
          throw error
        }
      }
    }

    await fs.rm(replacedRoot, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(session.tempRoot, { recursive: true, force: true }).catch(() => undefined)
    await fs.rmdir(path.dirname(session.tempRoot)).catch(() => undefined)
    this.sessions.delete(session.id)
    this.emitProgress(session, 'completed', null, true)

    const record: TransferRecord = {
      id: session.id,
      at: Date.now(),
      direction: 'incoming',
      peerName: session.senderName,
      peerPlatform: session.senderPlatform,
      saveNames: session.saveNames,
      totalBytes: session.totalBytes,
      fileCount: session.files.size,
      folderPath: session.destination,
      status: 'completed',
      error: null
    }
    this.options.onCompleted(record)

    return {
      ok: true,
      destinationPath: session.destination,
      backupPath: usedBackup ? backupRoot : null
    }
  }

  private async abort(id: string): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return
    await fs.rm(session.tempRoot, { recursive: true, force: true }).catch(() => undefined)
    this.sessions.delete(id)
    this.emitProgress(session, 'cancelled', null, true)
  }

  private emitProgress(
    session: TransferSession,
    status: TransferProgress['status'],
    currentFile: string | null,
    force = false
  ): void {
    const now = Date.now()
    if (!force && now - session.lastEmit < 90) return
    session.lastEmit = now
    let activeBytes = 0
    for (const bytes of session.activeFiles.values()) {
      activeBytes += bytes
    }
    const transferredBytes = Math.min(session.totalBytes, session.completedBytes + activeBytes)
    const elapsedSec = Math.max(0.15, (now - session.startedAt) / 1000)
    const speedBytesPerSec = Math.round(transferredBytes / elapsedSec)
    this.options.onProgress({
      transferId: session.id,
      direction: 'incoming',
      peerName: session.senderName,
      peerPlatform: session.senderPlatform,
      saveNames: session.saveNames,
      totalBytes: session.totalBytes,
      transferredBytes,
      fileCount: session.files.size,
      filesDone: session.completedFiles.size,
      currentFile,
      status,
      destinationPath: session.destination,
      error: null,
      speedBytesPerSec
    })
  }

  private async cleanupOrphanTemps(destination: string): Promise<void> {
    if (this.cleanedDestinations.has(destination)) return
    this.cleanedDestinations.add(destination)
    const tempRoot = path.join(destination, '.inzoi-save-bridge-tmp')
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(tempRoot, { withFileTypes: true })
    } catch {
      return
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const target = path.join(tempRoot, entry.name)
      try {
        const stat = await fs.stat(target)
        if (stat.mtimeMs < cutoff) {
          await fs.rm(target, { recursive: true, force: true })
        }
      } catch {
        /* ignore */
      }
    }
  }

  private cleanupStaleSessions(): void {
    const cutoff = Date.now() - 45 * 60 * 1000
    for (const [id, session] of this.sessions) {
      if (session.createdAt < cutoff) {
        void fs.rm(session.tempRoot, { recursive: true, force: true }).catch(() => undefined)
        this.sessions.delete(id)
      }
    }
  }
}
