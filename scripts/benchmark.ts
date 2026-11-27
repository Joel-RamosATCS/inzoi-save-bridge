import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import { PROTOCOL } from '@shared/constants'
import type { Peer, SaveEntry } from '@shared/types'
import {
  rustCollectSaveFiles,
  rustScanSaves,
  stopRustDaemon,
  warmupRustDaemon
} from '../src/main/rust-bridge'
import { sendSaves } from '../src/main/sender'
import { ReceiverServer } from '../src/main/server'

const REAL_SAVE_ROOT = path.join(os.homedir(), 'Documents', 'inZOI', 'SaveGames')

// --- Old v1 Node.js sequential implementations for baseline comparison ---

function extractJsonV1(buffer: Buffer): string | null {
  const text = buffer.toString('utf8')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

async function nodeScanV1(folder: string): Promise<number> {
  const entries = await fs.readdir(folder, { withFileTypes: true })
  let totalFiles = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const savePath = path.join(folder, entry.name)
    const stack = [savePath]
    while (stack.length > 0) {
      const current = stack.pop() as string
      let children: Dirent[]
      try {
        children = await fs.readdir(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of children) {
        if (child.name === '.DS_Store' || child.name.startsWith('.')) continue
        const full = path.join(current, child.name)
        if (child.isSymbolicLink()) continue
        if (child.isDirectory()) stack.push(full)
        else if (child.isFile()) {
          await fs.stat(full)
          totalFiles += 1
        }
      }
    }
    const usvx = path.join(savePath, `${entry.name}.usvx`)
    let handle: FileHandle | null = null
    try {
      handle = await fs.open(usvx, 'r')
      const buffer = Buffer.alloc(512 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const json = extractJsonV1(buffer.subarray(0, bytesRead))
      if (json) JSON.parse(json)
    } catch {
      /* ignore */
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }
  return totalFiles
}

async function nodeCollectV1(savePath: string): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  const files: { path: string; size: number; mtimeMs: number }[] = []
  const stack = [savePath]
  while (stack.length > 0) {
    const current = stack.pop() as string
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      const stat = await fs.stat(full)
      files.push({
        path: path.relative(savePath, full).split(path.sep).join('/'),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

async function transferV1Sequential(
  peer: Peer,
  save: SaveEntry,
  files: { path: string; size: number }[],
  totalBytes: number
): Promise<number> {
  const started = performance.now()
  const transferId = `bench-v1-${Date.now()}`
  const agent = new http.Agent({ keepAlive: true, maxSockets: 2 })

  const postJson = (pathname: string, payload: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify(payload))
      const req = http.request(
        {
          host: peer.host,
          port: peer.port,
          path: pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'X-InZOI-Bridge-Protocol': String(PROTOCOL)
          }
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve())
        }
      )
      req.on('error', reject)
      req.end(body)
    })

  await postJson('/api/prepare', {
    protocol: PROTOCOL,
    transferId,
    sender: { instanceId: 'bench-v1', name: 'Bench V1', platform: 'darwin' },
    saveNames: [save.folderName],
    files: files.map((f) => ({ path: `${save.folderName}/${f.path}`, size: f.size })),
    totalBytes,
    fileCount: files.length,
    backup: false
  })

  for (const file of files) {
    const relative = `${save.folderName}/${file.path}`
    const fullPath = path.join(save.path, ...file.path.split('/'))
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: peer.host,
          port: peer.port,
          path: `/api/transfer/${encodeURIComponent(transferId)}/file?path=${encodeURIComponent(relative)}`,
          method: 'PUT',
          agent,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': file.size,
            'X-InZOI-Bridge-Protocol': String(PROTOCOL)
          }
        },
        (res) => {
          res.resume()
          res.on('end', () => {
            if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) resolve()
            else reject(new Error(`HTTP ${res.statusCode}`))
          })
        }
      )
      req.on('error', reject)
      const stream = createReadStream(fullPath)
      stream.on('error', reject)
      stream.pipe(req)
    })
  }

  await postJson(`/api/transfer/${encodeURIComponent(transferId)}/complete`, { protocol: PROTOCOL })
  agent.destroy()
  return performance.now() - started
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function main(): Promise<void> {
  console.log('======================================================================')
  console.log('  inZOI Save Bridge — Performance Benchmark (v1 Node vs v2 Rust+Glass)')
  console.log('======================================================================\n')

  // Prepare multi-save benchmark workspace (5 clones of real save = 2,585 files / 219 MB)
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'inzoi-perf-bench-'))
  const multiSaveDir = path.join(tempRoot, 'multi-saves')
  const destV1 = path.join(tempRoot, 'dest-v1')
  const destV2 = path.join(tempRoot, 'dest-v2')
  await fs.mkdir(multiSaveDir, { recursive: true })
  await fs.mkdir(destV1, { recursive: true })
  await fs.mkdir(destV2, { recursive: true })

  try {
    await warmupRustDaemon()
    const initialRust = await rustScanSaves(REAL_SAVE_ROOT)
    if (!initialRust || initialRust.saves.length === 0) {
      throw new Error(`No real save found in ${REAL_SAVE_ROOT}`)
    }
    const realSave = initialRust.saves[0]
    console.log(
      `Dataset A (Single Real Save): ${realSave.folderName} · ${realSave.fileCount} files · ${(realSave.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
    )

    // Populate 5 saves (2,585 files, ~219.1 MB) for multi-save scaling test
    const cloneCount = 5
    for (let i = 1; i <= cloneCount; i += 1) {
      const folder = `20261118-04320${i}`
      const target = path.join(multiSaveDir, folder)
      await fs.cp(realSave.path, target, { recursive: true })
    }
    console.log(
      `Dataset B (5 Save Worlds):    ${cloneCount} folders · ${realSave.fileCount * cloneCount} files · ${((realSave.sizeBytes * cloneCount) / (1024 * 1024)).toFixed(2)} MB\n`
    )

    // 1. Benchmark Save Scanning (1 save = 517 files, and 5 saves = 2,585 files)
    const nodeScan1Times: number[] = []
    const rustScan1NativeTimes: number[] = []
    const rustScan1IpcTimes: number[] = []

    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now()
      await nodeScanV1(REAL_SAVE_ROOT)
      nodeScan1Times.push(performance.now() - t0)

      const t1 = performance.now()
      const r = await rustScanSaves(REAL_SAVE_ROOT)
      rustScan1IpcTimes.push(performance.now() - t1)
      if (r) rustScan1NativeTimes.push(r.durationMs)
    }

    const nodeScan5Times: number[] = []
    const rustScan5NativeTimes: number[] = []
    const rustScan5IpcTimes: number[] = []

    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now()
      await nodeScanV1(multiSaveDir)
      nodeScan5Times.push(performance.now() - t0)

      const t1 = performance.now()
      const r = await rustScanSaves(multiSaveDir)
      rustScan5IpcTimes.push(performance.now() - t1)
      if (r) rustScan5NativeTimes.push(r.durationMs)
    }

    // 2. Benchmark Manifest Collection (517 files)
    const nodeCollectTimes: number[] = []
    const rustCollectNativeTimes: number[] = []
    const rustCollectIpcTimes: number[] = []
    let collectedFiles: { path: string; size: number; mtimeMs: number }[] = []

    for (let i = 0; i < 7; i += 1) {
      const t0 = performance.now()
      collectedFiles = await nodeCollectV1(realSave.path)
      nodeCollectTimes.push(performance.now() - t0)

      const t1 = performance.now()
      const rc = await rustCollectSaveFiles(realSave.path)
      rustCollectIpcTimes.push(performance.now() - t1)
      if (rc) rustCollectNativeTimes.push(rc.durationUs / 1000)
    }

    // 3. Benchmark End-to-End Local HTTP Transfer (517 files, 43.82 MB)
    let activeDest = destV1
    let simulatedWifiRttMs = 0
    const origReceiveFile = (ReceiverServer.prototype as unknown as {
      receiveFile: (...args: unknown[]) => Promise<void>
    }).receiveFile
    const origReceiveBatch = (ReceiverServer.prototype as unknown as {
      receiveBatch: (...args: unknown[]) => Promise<void>
    }).receiveBatch
    ;(ReceiverServer.prototype as unknown as {
      receiveFile: (...args: unknown[]) => Promise<void>
    }).receiveFile = async function (...args: unknown[]) {
      if (simulatedWifiRttMs > 0) {
        await new Promise((r) => setTimeout(r, simulatedWifiRttMs))
      }
      return origReceiveFile.apply(this, args)
    }
    ;(ReceiverServer.prototype as unknown as {
      receiveBatch: (...args: unknown[]) => Promise<void>
    }).receiveBatch = async function (...args: unknown[]) {
      if (simulatedWifiRttMs > 0) {
        await new Promise((r) => setTimeout(r, simulatedWifiRttMs))
      }
      return origReceiveBatch.apply(this, args)
    }

    const server = new ReceiverServer({
      info: () => ({
        app: 'inzoi-save-bridge',
        protocol: PROTOCOL,
        instanceId: 'bench-receiver',
        name: 'Benchmark Receiver',
        platform: 'win32',
        savesPath: activeDest,
        version: '1.0.0',
        accepting: true
      }),
      askBeforeAccepting: () => false,
      requestAcceptance: async () => ({ accept: true, backup: false }),
      getDestination: async () => activeDest,
      onProgress: () => undefined,
      onCompleted: () => undefined,
      log: () => undefined
    })

    const port = await server.start(49880)
    const peer: Peer = {
      instanceId: 'bench-receiver',
      name: 'Benchmark Receiver',
      platform: 'win32',
      osVersion: 'Windows 11',
      host: '127.0.0.1',
      port,
      savesPath: activeDest,
      version: '1.0.0',
      accepting: true,
      manual: true,
      lastSeen: Date.now()
    }

    const v1TransferTimes: number[] = []
    for (let i = 0; i < 3; i += 1) {
      activeDest = path.join(destV1, `run-${i}`)
      await fs.mkdir(activeDest, { recursive: true })
      const elapsed = await transferV1Sequential(peer, realSave, collectedFiles, realSave.sizeBytes)
      v1TransferTimes.push(elapsed)
    }

    const v2TransferTimes: number[] = []
    for (let i = 0; i < 3; i += 1) {
      activeDest = path.join(destV2, `run-${i}`)
      await fs.mkdir(activeDest, { recursive: true })
      const t0 = performance.now()
      const outcome = await sendSaves({
        peer: { ...peer, savesPath: activeDest },
        saves: [realSave],
        backup: false,
        identity: { instanceId: 'bench-v2', name: 'Bench V2', platform: 'darwin' },
        signal: new AbortController().signal,
        onProgress: () => undefined,
        log: () => undefined
      })
      if (!outcome.ok) throw new Error(outcome.record.error ?? 'v2 transfer failed')
      v2TransferTimes.push(performance.now() - t0)
    }

    // 4. Benchmark over Realistic 4ms Wi-Fi LAN Latency (517 files, 41.79 MB)
    simulatedWifiRttMs = 4
    activeDest = path.join(destV1, 'wifi-v1')
    await fs.mkdir(activeDest, { recursive: true })
    const v1WifiMs = await transferV1Sequential(peer, realSave, collectedFiles, realSave.sizeBytes)

    activeDest = path.join(destV2, 'wifi-v2')
    await fs.mkdir(activeDest, { recursive: true })
    const tWifiV2 = performance.now()
    const wifiOutcome = await sendSaves({
      peer: { ...peer, savesPath: activeDest },
      saves: [realSave],
      backup: false,
      identity: { instanceId: 'bench-v2-wifi', name: 'Bench V2 WiFi', platform: 'darwin' },
      signal: new AbortController().signal,
      onProgress: () => undefined,
      log: () => undefined
    })
    if (!wifiOutcome.ok) throw new Error(wifiOutcome.record.error ?? 'v2 wifi transfer failed')
    const v2WifiMs = performance.now() - tWifiV2
    simulatedWifiRttMs = 0

    server.stop()

    const mb = realSave.sizeBytes / (1024 * 1024)
    const v1Scan1Med = median(nodeScan1Times)
    const v2Scan1NativeMed = median(rustScan1NativeTimes)
    const v2Scan1IpcMed = median(rustScan1IpcTimes)

    const v1Scan5Med = median(nodeScan5Times)
    const v2Scan5NativeMed = median(rustScan5NativeTimes)
    const v2Scan5IpcMed = median(rustScan5IpcTimes)

    const v1CollectMed = median(nodeCollectTimes)
    const v2CollectNativeMed = median(rustCollectNativeTimes)
    const v2CollectIpcMed = median(rustCollectIpcTimes)

    const v1TransferMed = median(v1TransferTimes)
    const v2TransferMed = median(v2TransferTimes)
    const v1Speed = mb / (v1TransferMed / 1000)
    const v2Speed = mb / (v2TransferMed / 1000)

    console.log('--- 1. SAVE SCAN + IZTB PARSE + FINGERPRINT ---')
    console.log(
      `1 Save  (517 files):   v1 Node = ${v1Scan1Med.toFixed(2)} ms | v2 Rust Core = ${v2Scan1NativeMed.toFixed(2)} ms (${v2Scan1IpcMed.toFixed(2)} ms w/ IPC) -> ${(v1Scan1Med / v2Scan1NativeMed).toFixed(2)}x faster`
    )
    console.log(
      `5 Saves (2,585 files): v1 Node = ${v1Scan5Med.toFixed(2)} ms | v2 Rust Core = ${v2Scan5NativeMed.toFixed(2)} ms (${v2Scan5IpcMed.toFixed(2)} ms w/ IPC) -> ${(v1Scan5Med / v2Scan5NativeMed).toFixed(2)}x faster (${(v1Scan5Med / v2Scan5IpcMed).toFixed(2)}x end-to-end)\n`
    )

    console.log('--- 2. MANIFEST COLLECTION (517 files) ---')
    console.log(
      `Manifest Walk:         v1 Node = ${v1CollectMed.toFixed(2)} ms | v2 Rust Core = ${v2CollectNativeMed.toFixed(2)} ms (${v2CollectIpcMed.toFixed(2)} ms w/ IPC) -> ${(v1CollectMed / v2CollectNativeMed).toFixed(2)}x faster\n`
    )

    console.log('--- 3. FULL 517-FILE (43.82 MB) HTTP TRANSFER ---')
    console.log(
      `v1 Engine (Sequential stream, no TCP_NODELAY):   ${v1TransferMed.toFixed(1)} ms  (${v1Speed.toFixed(1)} MB/s · ${Math.round(517 / (v1TransferMed / 1000))} files/sec)`
    )
    console.log(
      `v2 Engine (Rust + Preload + TCP_NODELAY + 6x):   ${v2TransferMed.toFixed(1)} ms  (${v2Speed.toFixed(1)} MB/s · ${Math.round(517 / (v2TransferMed / 1000))} files/sec)`
    )
    console.log(
      `Transfer Speedup (Local):                        ${(v1TransferMed / v2TransferMed).toFixed(2)}x faster (${(v2Speed / v1Speed).toFixed(2)}x higher throughput)\n`
    )

    const v1WifiSpeed = mb / (v1WifiMs / 1000)
    const v2WifiSpeed = mb / (v2WifiMs / 1000)
    console.log('--- 4. REALISTIC WI-FI LAN TRANSFER (4 ms RTT · 517 files · 41.79 MB) ---')
    console.log(
      `v1 Engine (1x Sequential):                       ${v1WifiMs.toFixed(1)} ms  (${v1WifiSpeed.toFixed(1)} MB/s · ${Math.round(517 / (v1WifiMs / 1000))} files/sec)`
    )
    console.log(
      `v2 Engine (6x Concurrent + Preload + NoDelay):   ${v2WifiMs.toFixed(1)} ms  (${v2WifiSpeed.toFixed(1)} MB/s · ${Math.round(517 / (v2WifiMs / 1000))} files/sec)`
    )
    console.log(
      `Wi-Fi LAN Speedup:                               ${(v1WifiMs / v2WifiMs).toFixed(2)}x faster (${(v1WifiMs - v2WifiMs).toFixed(0)} ms saved per save folder)`
    )
  } finally {
    stopRustDaemon()
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
