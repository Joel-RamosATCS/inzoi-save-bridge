import { createReadStream, promises as fs } from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import {
  MAX_TRANSFER_BYTES,
  MAX_TRANSFER_FILES,
  PROTOCOL
} from '@shared/constants'
import type {
  AppPlatform,
  Peer,
  SaveEntry,
  TransferProgress,
  TransferRecord,
  TransferStatus
} from '@shared/types'
import { rustProbePeer } from './rust-bridge'
import { collectSaveFiles } from './saves'

export interface SenderIdentity {
  instanceId: string
  name: string
  platform: AppPlatform
}

interface PrepareResponse {
  ok?: boolean
  transferId?: string
  destinationPath?: string
  error?: string
  capabilities?: string[]
}

interface CompleteResponse {
  ok?: boolean
  destinationPath?: string
  backupPath?: string | null
  error?: string
}

export interface SendOptions {
  peer: Peer
  saves: SaveEntry[]
  backup: boolean
  identity: SenderIdentity
  signal: AbortSignal
  onProgress: (progress: TransferProgress) => void
  log: (message: string) => void
}

export interface SendOutcome {
  ok: boolean
  record: TransferRecord
}

interface JsonResponse {
  status: number
  body: Record<string, unknown>
}

interface QueueFileItem {
  relative: string
  displayPath: string
  fullPath: string
  size: number
}

type WorkUnit =
  | { kind: 'single'; item: QueueFileItem }
  | { kind: 'batch'; items: QueueFileItem[]; totalBytes: number }

const SMALL_FILE_THRESHOLD = 512 * 1024
const BATCH_ELIGIBLE_MAX_FILE = 1024 * 1024
const BATCH_MAX_BYTES = 6 * 1024 * 1024
const BATCH_MAX_FILES = 128
const RETRY_DELAYS_MS = [250, 600, 1200, 2200, 3500]

function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false
  const code = (error as NodeJS.ErrnoException).code ?? ''
  const msg = ((error as Error).message ?? '').toLowerCase()
  if (
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'EADDRNOTAVAIL' ||
    code === 'ECONNREFUSED' ||
    code === 'EAGAIN'
  ) {
    return true
  }
  return (
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('timed out') ||
    msg.includes('currently uploading') ||
    msg.includes('still uploading')
  )
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('cancelled'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function warmupPeerRoute(peer: Peer, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const probe = await rustProbePeer(peer.host, peer.port, 1800)
  if (probe?.reachable) return
  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        host: peer.host,
        port: peer.port,
        path: '/api/info',
        method: 'GET',
        timeout: 1800,
        signal
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve())
      }
    )
    req.on('socket', (socket) => socket.setNoDelay(true))
    req.on('timeout', () => {
      req.destroy()
      resolve()
    })
    req.on('error', () => resolve())
    req.end()
  })
}

async function withNetworkRetry<T>(
  operation: () => Promise<T>,
  peer: Peer,
  signal: AbortSignal,
  log: (msg: string) => void,
  label: string
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (signal.aborted) throw new Error('cancelled')
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (signal.aborted || !isTransientNetworkError(error) || attempt === RETRY_DELAYS_MS.length) {
        throw error
      }
      const delay = RETRY_DELAYS_MS[attempt]
      log(
        `Transient network error during ${label} (${(error as Error).message}). Warming route & retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})...`
      )
      await warmupPeerRoute(peer, signal)
      await sleep(delay, signal)
    }
  }
  throw lastError
}

function requestJsonOnce(
  target: Peer,
  method: 'POST',
  pathname: string,
  payload: unknown,
  signal: AbortSignal,
  timeoutMs: number,
  agent?: http.Agent
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload))
    const request = http.request(
      {
        host: target.host,
        port: target.port,
        path: pathname,
        method,
        agent,
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'X-InZOI-Bridge-Protocol': String(PROTOCOL)
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 1024 * 1024) {
            response.destroy()
            reject(new Error('The other PC sent an unexpected response.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let parsed: Record<string, unknown> = {}
          try {
            parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
          } catch {
            parsed = { error: text.slice(0, 300) }
          }
          resolve({ status: response.statusCode ?? 0, body: parsed })
        })
        response.on('error', reject)
      }
    )
    request.on('socket', (socket) => {
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 5000)
    })
    request.on('timeout', () => request.destroy(new Error('The other PC took too long to respond.')))
    request.on('error', reject)
    request.end(body)
  })
}

async function uploadBatchOnce(
  target: Peer,
  transferId: string,
  items: QueueFileItem[],
  signal: AbortSignal,
  agent: http.Agent,
  onBytes: (deltaBytes: number) => void
): Promise<void> {
  const pathBuffers = items.map((item) => Buffer.from(item.relative, 'utf8'))
  const dataOffsets: number[] = new Array(items.length)

  let totalFrameBytes = 0
  let rawFileBytes = 0
  for (let i = 0; i < items.length; i += 1) {
    totalFrameBytes += 6 + pathBuffers[i].byteLength + items[i].size
    rawFileBytes += items[i].size
  }

  // Zero-copy single slab buffer: headers + paths written in-place, files read directly into their target offsets
  const payload = Buffer.allocUnsafe(totalFrameBytes)
  let offset = 0
  for (let i = 0; i < items.length; i += 1) {
    const pBuf = pathBuffers[i]
    const fSize = items[i].size
    payload.writeUInt16LE(pBuf.byteLength, offset)
    payload.writeUInt32LE(fSize, offset + 2)
    offset += 6
    pBuf.copy(payload, offset)
    offset += pBuf.byteLength
    dataOffsets[i] = offset
    offset += fSize
  }

  const readConcurrency = 32
  for (let i = 0; i < items.length; i += readConcurrency) {
    const end = Math.min(items.length, i + readConcurrency)
    const sliceTasks: Promise<void>[] = []
    for (let j = i; j < end; j += 1) {
      const item = items[j]
      const targetOffset = dataOffsets[j]
      if (item.size === 0) continue
      sliceTasks.push(
        (async () => {
          const fh = await fs.open(item.fullPath, 'r')
          try {
            let readSoFar = 0
            while (readSoFar < item.size) {
              const { bytesRead } = await fh.read(
                payload,
                targetOffset + readSoFar,
                item.size - readSoFar,
                readSoFar
              )
              if (bytesRead === 0) break
              readSoFar += bytesRead
            }
          } finally {
            await fh.close()
          }
        })()
      )
    }
    await Promise.all(sliceTasks)
  }

  return new Promise((resolve, reject) => {
    let accounted = false
    const request = http.request(
      {
        host: target.host,
        port: target.port,
        path: `/api/transfer/${encodeURIComponent(transferId)}/batch`,
        method: 'POST',
        agent,
        signal,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': payload.byteLength,
          'X-InZOI-Bridge-Protocol': String(PROTOCOL)
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) {
            resolve()
            return
          }
          if (accounted) {
            onBytes(-rawFileBytes)
            accounted = false
          }
          let message = 'The other PC rejected a file batch.'
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: string }
            if (parsed.error) message = parsed.error
          } catch {
            /* keep default */
          }
          reject(new Error(message))
        })
      }
    )

    request.on('socket', (socket) => {
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 5000)
    })

    request.on('error', (err) => {
      if (accounted) {
        onBytes(-rawFileBytes)
        accounted = false
      }
      reject(err)
    })

    accounted = true
    onBytes(rawFileBytes)
    request.end(payload)
  })
}

async function uploadFileOnce(
  target: Peer,
  transferId: string,
  relative: string,
  filePath: string,
  size: number,
  signal: AbortSignal,
  agent: http.Agent,
  onBytes: (deltaBytes: number) => void
): Promise<void> {
  const preloaded = size <= SMALL_FILE_THRESHOLD ? await fs.readFile(filePath) : null

  return new Promise((resolve, reject) => {
    let sentBytes = 0
    const request = http.request(
      {
        host: target.host,
        port: target.port,
        path: `/api/transfer/${encodeURIComponent(transferId)}/file?path=${encodeURIComponent(relative)}`,
        method: 'PUT',
        agent,
        signal,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
          'X-InZOI-Bridge-Protocol': String(PROTOCOL)
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) {
            resolve()
            return
          }
          if (sentBytes > 0) {
            onBytes(-sentBytes)
            sentBytes = 0
          }
          let message = `The other PC rejected ${relative}.`
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: string }
            if (parsed.error) message = parsed.error
          } catch {
            /* keep default */
          }
          reject(new Error(message))
        })
      }
    )

    request.on('socket', (socket) => {
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 5000)
    })

    request.on('error', (err) => {
      if (sentBytes > 0) {
        onBytes(-sentBytes)
        sentBytes = 0
      }
      reject(err)
    })

    if (preloaded) {
      sentBytes = preloaded.byteLength
      onBytes(sentBytes)
      request.end(preloaded)
      return
    }

    const stream = createReadStream(filePath, { highWaterMark: 512 * 1024 })
    stream.on('data', (chunk) => {
      const len = typeof chunk === 'string' ? chunk.length : chunk.byteLength
      sentBytes += len
      onBytes(len)
    })
    stream.on('error', (error) => {
      if (sentBytes > 0) {
        onBytes(-sentBytes)
        sentBytes = 0
      }
      request.destroy()
      reject(error)
    })
    stream.pipe(request)
  })
}

function buildWorkUnits(files: QueueFileItem[], useBatching: boolean): WorkUnit[] {
  if (!useBatching) {
    return files.map((item) => ({ kind: 'single', item }))
  }
  const units: WorkUnit[] = []
  let currentBatch: QueueFileItem[] = []
  let currentBatchBytes = 0

  for (const item of files) {
    if (item.size > BATCH_ELIGIBLE_MAX_FILE) {
      units.push({ kind: 'single', item })
      continue
    }
    if (
      currentBatch.length >= BATCH_MAX_FILES ||
      (currentBatch.length > 0 && currentBatchBytes + item.size > BATCH_MAX_BYTES)
    ) {
      units.push({ kind: 'batch', items: currentBatch, totalBytes: currentBatchBytes })
      currentBatch = []
      currentBatchBytes = 0
    }
    currentBatch.push(item)
    currentBatchBytes += item.size
  }

  if (currentBatch.length > 0) {
    units.push({ kind: 'batch', items: currentBatch, totalBytes: currentBatchBytes })
  }

  return units
}

export async function sendSaves(options: SendOptions): Promise<SendOutcome> {
  const { peer, saves, signal, onProgress, identity, log } = options
  const transferId = crypto.randomUUID()
  const saveNames = saves.map((save) => save.folderName)
  let totalBytes = 0
  let fileCount = 0
  let transferredBytes = 0
  let inFlightBytes = 0
  let filesDone = 0
  let currentFile: string | null = null
  let destinationPath = peer.savesPath
  let status: TransferStatus = 'preparing'
  let lastEmit = 0
  let lastError: string | null = null
  let transferStartedAt = Date.now()

  const emit = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 80) return
    lastEmit = now
    const effectiveBytes = Math.max(0, Math.min(totalBytes, transferredBytes + inFlightBytes))
    const elapsedSec = Math.max(0.05, (now - transferStartedAt) / 1000)
    const speedBytesPerSec =
      status === 'transferring' || status === 'finalizing' || status === 'completed'
        ? Math.round(effectiveBytes / elapsedSec)
        : 0
    onProgress({
      transferId,
      direction: 'outgoing',
      peerName: peer.name,
      peerPlatform: peer.platform,
      saveNames,
      totalBytes,
      transferredBytes: effectiveBytes,
      fileCount,
      filesDone,
      currentFile,
      status,
      destinationPath,
      error: lastError,
      speedBytesPerSec
    })
  }

  emit(true)
  const agent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 15_000,
    maxSockets: 6,
    scheduling: 'fifo'
  })

  const fail = (error: unknown, cancelled: boolean): SendOutcome => {
    const rawMsg = (error as Error)?.message || 'Transfer failed.'
    lastError = cancelled
      ? 'Transfer cancelled.'
      : isTransientNetworkError(error)
        ? `Could not reach ${peer.name} (${peer.host}:${peer.port}). Check that both devices are awake on the same Wi-Fi and Local Network access is allowed.`
        : rawMsg
    status = cancelled ? 'cancelled' : 'failed'
    currentFile = null
    inFlightBytes = 0
    emit(true)
    agent.destroy()
    const record: TransferRecord = {
      id: transferId,
      at: Date.now(),
      direction: 'outgoing',
      peerName: peer.name,
      peerPlatform: peer.platform,
      saveNames,
      totalBytes,
      fileCount,
      folderPath: destinationPath ?? '',
      status: cancelled ? 'cancelled' : 'failed',
      error: lastError
    }
    return { ok: false, record }
  }

  if (!peer.port) return fail(new Error('That PC is not accepting transfers right now.'), false)

  try {
    const collected = await Promise.all(saves.map((save) => collectSaveFiles(save)))
    if (signal.aborted) return fail(new Error('cancelled'), true)
    for (const result of collected) {
      totalBytes += result.totalBytes
      fileCount += result.fileCount
    }
    emit(true)
    if (fileCount === 0) throw new Error('The selected saves are empty.')
    if (fileCount > MAX_TRANSFER_FILES) throw new Error('That is too many files for one transfer.')
    if (totalBytes > MAX_TRANSFER_BYTES) throw new Error('Those saves are too large to transfer.')

    status = 'waiting'
    emit(true)
    const prepare = await withNetworkRetry(
      () =>
        requestJsonOnce(
          peer,
          'POST',
          '/api/prepare',
          {
            protocol: PROTOCOL,
            transferId,
            sender: identity,
            saveNames,
            files: collected.flatMap((save) =>
              save.files.map((file) => ({
                path: `${save.folderName}/${file.path}`,
                size: file.size
              }))
            ),
            totalBytes,
            fileCount,
            backup: options.backup
          },
          signal,
          10 * 60 * 1000,
          agent
        ),
      peer,
      signal,
      log,
      'prepare'
    )
    if (prepare.status === 403) {
      const message =
        typeof prepare.body.error === 'string'
          ? prepare.body.error
          : 'The transfer was declined on the other PC.'
      throw new Error(message)
    }
    if (prepare.status < 200 || prepare.status >= 300) {
      const message =
        typeof prepare.body.error === 'string'
          ? prepare.body.error
          : 'The other PC could not start the transfer.'
      throw new Error(message)
    }
    const prepared = prepare.body as PrepareResponse
    if (prepared.transferId && prepared.transferId !== transferId) {
      throw new Error('The other PC returned an unexpected transfer session.')
    }
    if (prepared.destinationPath) destinationPath = prepared.destinationPath

    const caps = Array.isArray(prepared.capabilities) ? prepared.capabilities : []
    const supportsBatch = caps.includes('batch-v3')
    const supportsConcurrent = supportsBatch || caps.includes('concurrent-v2')
    const concurrency = supportsConcurrent ? 6 : 1

    const allFiles: QueueFileItem[] = []
    for (const save of collected) {
      for (const file of save.files) {
        allFiles.push({
          relative: `${save.folderName}/${file.path}`,
          displayPath: file.path,
          fullPath: path.join(save.path, ...file.path.split('/')),
          size: file.size
        })
      }
    }

    const workUnits = buildWorkUnits(allFiles, supportsBatch)

    status = 'transferring'
    transferStartedAt = Date.now()
    emit(true)

    let nextUnitIndex = 0
    const runWorker = async (): Promise<void> => {
      while (nextUnitIndex < workUnits.length) {
        if (signal.aborted) throw new Error('cancelled')
        const idx = nextUnitIndex
        nextUnitIndex += 1
        const unit = workUnits[idx]

        if (unit.kind === 'batch') {
          currentFile = unit.items[unit.items.length - 1]?.displayPath ?? null
          let unitInFlight = 0
          await withNetworkRetry(
            async () => {
              if (unitInFlight > 0) {
                inFlightBytes = Math.max(0, inFlightBytes - unitInFlight)
                unitInFlight = 0
              }
              await uploadBatchOnce(peer, transferId, unit.items, signal, agent, (delta) => {
                unitInFlight += delta
                inFlightBytes = Math.max(0, inFlightBytes + delta)
                emit()
              })
            },
            peer,
            signal,
            log,
            `batch(${unit.items.length} files)`
          )
          inFlightBytes = Math.max(0, inFlightBytes - unitInFlight)
          transferredBytes += unit.totalBytes
          filesDone += unit.items.length
          emit(true)
        } else {
          const item = unit.item
          currentFile = item.displayPath
          let fileInFlight = 0
          await withNetworkRetry(
            async () => {
              if (fileInFlight > 0) {
                inFlightBytes = Math.max(0, inFlightBytes - fileInFlight)
                fileInFlight = 0
              }
              await uploadFileOnce(
                peer,
                transferId,
                item.relative,
                item.fullPath,
                item.size,
                signal,
                agent,
                (delta) => {
                  fileInFlight += delta
                  inFlightBytes = Math.max(0, inFlightBytes + delta)
                  emit()
                }
              )
            },
            peer,
            signal,
            log,
            item.relative
          )
          inFlightBytes = Math.max(0, inFlightBytes - fileInFlight)
          transferredBytes += item.size
          filesDone += 1
          emit(filesDone === fileCount || filesDone % 12 === 0)
        }
      }
    }

    const workers: Promise<void>[] = []
    for (let i = 0; i < Math.min(concurrency, workUnits.length); i += 1) {
      workers.push(runWorker())
    }
    await Promise.all(workers)

    currentFile = null
    inFlightBytes = 0
    status = 'finalizing'
    emit(true)
    const complete = await withNetworkRetry(
      () =>
        requestJsonOnce(
          peer,
          'POST',
          `/api/transfer/${encodeURIComponent(transferId)}/complete`,
          { protocol: PROTOCOL },
          signal,
          5 * 60 * 1000,
          agent
        ),
      peer,
      signal,
      log,
      'complete'
    )
    if (complete.status < 200 || complete.status >= 300) {
      const message =
        typeof complete.body.error === 'string'
          ? complete.body.error
          : 'The other PC could not finish the transfer.'
      throw new Error(message)
    }
    const completed = complete.body as CompleteResponse
    if (completed.destinationPath) destinationPath = completed.destinationPath

    transferredBytes = totalBytes
    filesDone = fileCount
    currentFile = null
    status = 'completed'
    emit(true)
    agent.destroy()

    return {
      ok: true,
      record: {
        id: transferId,
        at: Date.now(),
        direction: 'outgoing',
        peerName: peer.name,
        peerPlatform: peer.platform,
        saveNames,
        totalBytes,
        fileCount,
        folderPath: destinationPath ?? '',
        status: 'completed',
        error: null
      }
    }
  } catch (error) {
    if (signal.aborted) return fail(error, true)
    agent.destroy()
    try {
      if (status === 'transferring' || status === 'finalizing') {
        await requestJsonOnce(
          peer,
          'POST',
          `/api/transfer/${encodeURIComponent(transferId)}/abort`,
          {},
          new AbortController().signal,
          5000
        )
      }
    } catch {
      /* best effort */
    }
    return fail(error, false)
  }
}
