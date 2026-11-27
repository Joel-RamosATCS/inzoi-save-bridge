import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { EngineKind, SaveAccent, SaveEntry } from '@shared/types'

export interface RustScanOutput {
  reqId?: string
  engine: EngineKind
  durationUs: number
  saves: Array<{
    id: string
    folderName: string
    path: string
    title: string
    world: string
    characterName: string | null
    modifiedAt: number
    sizeBytes: number
    fileCount: number
    gameVersion: string | null
    saveType: string | null
    savedTime?: string | null
    accent: SaveAccent
    metadataFound: boolean
    fingerprint?: string
  }>
}

export interface RustCollectOutput {
  reqId?: string
  engine: EngineKind
  durationUs: number
  totalBytes: number
  fileCount: number
  files: Array<{
    path: string
    size: number
    mtimeMs: number
  }>
}

export interface RustProbeOutput {
  reqId?: string
  reachable: boolean
  rttMs?: number
  info?: Record<string, unknown> | null
  error?: string
}

type DaemonChild = ChildProcessByStdio<Writable, Readable, null>
type RefableStream = Readable & { ref?: () => void; unref?: () => void }

let cachedBinaryPath: string | null | undefined
let daemonProcess: DaemonChild | null = null
let daemonSeq = 0
const pendingDaemonCalls = new Map<
  string,
  {
    resolve: (value: unknown) => void
    timer: NodeJS.Timeout
  }
>()

function parseSavedTime(value: string | null | undefined): number | null {
  if (!value) return null
  const match = value.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const time = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ).getTime()
  return Number.isFinite(time) ? time : null
}

export function resolveRustCoreBinary(): string | null {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath
  const exeName = process.platform === 'win32' ? 'inzoi-core.exe' : 'inzoi-core'
  const candidates: string[] = []

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'bin', exeName))
  }
  candidates.push(
    path.resolve(process.cwd(), 'resources', 'bin', exeName),
    path.resolve(process.cwd(), 'rust-core', 'target', 'release', exeName),
    path.resolve(__dirname, '../../resources/bin', exeName),
    path.resolve(__dirname, '../../../resources/bin', exeName)
  )

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        cachedBinaryPath = candidate
        return candidate
      }
    } catch {
      /* ignore */
    }
  }
  cachedBinaryPath = null
  return null
}

function ensureDaemon(): DaemonChild | null {
  if (daemonProcess && !daemonProcess.killed && daemonProcess.exitCode === null) {
    return daemonProcess
  }
  const bin = resolveRustCoreBinary()
  if (!bin) return null
  try {
    const child = spawn(bin, ['daemon'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })
    child.unref()
    const stdoutRef = child.stdout as RefableStream
    stdoutRef.unref?.()
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    })
    rl.on('line', (line) => {
      if (!line) return
      try {
        const parsed = JSON.parse(line) as { reqId?: string }
        const reqId = parsed.reqId
        if (!reqId) return
        const entry = pendingDaemonCalls.get(reqId)
        if (!entry) return
        pendingDaemonCalls.delete(reqId)
        clearTimeout(entry.timer)
        if (pendingDaemonCalls.size === 0) {
          stdoutRef.unref?.()
        }
        entry.resolve(parsed)
      } catch {
        /* ignore malformed line */
      }
    })
    const onExit = (): void => {
      if (daemonProcess === child) daemonProcess = null
      for (const [id, entry] of pendingDaemonCalls) {
        pendingDaemonCalls.delete(id)
        clearTimeout(entry.timer)
        entry.resolve(null)
      }
    }
    child.once('exit', onExit)
    child.once('error', onExit)
    daemonProcess = child
    return child
  } catch {
    daemonProcess = null
    return null
  }
}

function callDaemon<T>(command: string, args: string[], timeoutMs: number): Promise<T | null> {
  const child = ensureDaemon()
  if (!child) return Promise.resolve(null)
  daemonSeq += 1
  const reqId = String(daemonSeq)
  const stdoutRef = child.stdout as RefableStream
  stdoutRef.ref?.()
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      pendingDaemonCalls.delete(reqId)
      if (pendingDaemonCalls.size === 0) {
        stdoutRef.unref?.()
      }
      resolve(null)
    }, timeoutMs)
    pendingDaemonCalls.set(reqId, {
      resolve: (val) => resolve((val as T) ?? null),
      timer
    })
    const line = `${[command, reqId, ...args].join('\t')}\n`
    try {
      child.stdin.write(line)
    } catch {
      pendingDaemonCalls.delete(reqId)
      clearTimeout(timer)
      if (pendingDaemonCalls.size === 0) {
        stdoutRef.unref?.()
      }
      resolve(null)
    }
  })
}

function runRustCoreExec<T>(args: string[], timeoutMs = 12_000): Promise<T | null> {
  const bin = resolveRustCoreBinary()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(stdout.trim()) as T)
        } catch {
          resolve(null)
        }
      }
    )
  })
}

export async function warmupRustDaemon(): Promise<void> {
  await callDaemon('PING', [], 1500)
}

export function stopRustDaemon(): void {
  if (!daemonProcess) return
  try {
    daemonProcess.stdin.write('QUIT\t0\n')
    daemonProcess.kill()
  } catch {
    /* ignore */
  }
  daemonProcess = null
}

export async function rustScanSaves(
  folder: string
): Promise<{ saves: SaveEntry[]; durationMs: number; engine: EngineKind } | null> {
  const cleanFolder = folder.replace(/[\t\r\n]/g, '')
  const output =
    (await callDaemon<RustScanOutput>('SCAN', [cleanFolder], 12_000)) ??
    (await runRustCoreExec<RustScanOutput>(['scan', cleanFolder], 12_000))
  if (!output || !Array.isArray(output.saves)) return null

  const saves: SaveEntry[] = output.saves.map((item) => {
    const savedTimeMs = parseSavedTime(item.savedTime)
    const modifiedAt = Math.max(savedTimeMs ?? 0, item.modifiedAt)
    return {
      id: item.id,
      folderName: item.folderName,
      path: item.path,
      title: item.title,
      world: item.world,
      characterName: item.characterName,
      modifiedAt,
      sizeBytes: item.sizeBytes,
      fileCount: item.fileCount,
      gameVersion: item.gameVersion,
      saveType: item.saveType,
      accent: item.accent,
      metadataFound: item.metadataFound,
      fingerprint: item.fingerprint
    }
  })
  saves.sort((a, b) => b.modifiedAt - a.modifiedAt)
  return {
    saves,
    durationMs: Math.max(0.1, Math.round((output.durationUs / 1000) * 10) / 10),
    engine: 'rust-native'
  }
}

export async function rustCollectSaveFiles(
  savePath: string
): Promise<RustCollectOutput | null> {
  const cleanPath = savePath.replace(/[\t\r\n]/g, '')
  const output =
    (await callDaemon<RustCollectOutput>('COLLECT', [cleanPath], 12_000)) ??
    (await runRustCoreExec<RustCollectOutput>(['collect', cleanPath], 12_000))
  if (!output || !Array.isArray(output.files)) return null
  return output
}

export async function rustProbePeer(
  host: string,
  port: number,
  timeoutMs = 2500
): Promise<RustProbeOutput | null> {
  const cleanHost = host.replace(/[\t\r\n]/g, '')
  return (
    (await callDaemon<RustProbeOutput>(
      'PROBE',
      [cleanHost, String(port), String(timeoutMs)],
      timeoutMs + 1000
    )) ??
    (await runRustCoreExec<RustProbeOutput>(
      ['probe', cleanHost, String(port), String(timeoutMs)],
      timeoutMs + 1000
    ))
  )
}
