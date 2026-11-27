import { app } from 'electron'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AppPlatform,
  AppSettings,
  SaveFolderCandidate,
  SaveFolderState,
  SaveKind
} from '@shared/types'

export interface CandidateSpec {
  id: string
  label: string
  path: string
  kind: SaveKind
}

export function currentPlatform(): AppPlatform {
  return process.platform
}

function documentsDir(): string {
  try {
    return app.getPath('documents')
  } catch {
    return path.join(os.homedir(), 'Documents')
  }
}

export function platformLabel(platform: AppPlatform): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  return 'Linux'
}

export function platformVersionLabel(platform: AppPlatform): string {
  if (platform === 'darwin') {
    const version = process.getSystemVersion?.() ?? os.release()
    return `macOS ${version}`
  }
  if (platform === 'win32') {
    return `Windows ${os.release().split('.')[0] === '10' ? '10/11' : os.release()}`
  }
  return 'Linux'
}

export function defaultDeviceName(): string {
  const raw = os.hostname().replace(/\.local$/i, '')
  if (!raw) return 'My computer'
  const cleaned = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned
    .split(' ')
    .map((part) => (part.length > 2 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ')
}

export function candidateSpecs(platform: AppPlatform = process.platform): CandidateSpec[] {
  const home = os.homedir()
  if (platform === 'darwin') {
    return [
      {
        id: 'mac-app-store',
        label: 'Mac App Store',
        kind: 'app-store',
        path: path.join(
          home,
          'Library',
          'Containers',
          'com.krafton.inzoi',
          'Data',
          'Documents',
          'inZOI',
          'SaveGames'
        )
      },
      {
        id: 'mac-steam',
        label: 'Steam',
        kind: 'steam',
        path: path.join(documentsDir(), 'inZOI', 'SaveGames')
      }
    ]
  }

  if (platform === 'win32') {
    const candidates: CandidateSpec[] = [
      {
        id: 'win-documents',
        label: 'Documents',
        kind: 'steam',
        path: path.join(documentsDir(), 'inZOI', 'SaveGames')
      }
    ]
    const oneDrive = process.env.OneDrive
    if (oneDrive) {
      candidates.push({
        id: 'win-onedrive',
        label: 'OneDrive Documents',
        kind: 'steam',
        path: path.join(oneDrive, 'Documents', 'inZOI', 'SaveGames')
      })
    }
    return candidates
  }

  return [
    {
      id: 'linux-documents',
      label: 'Documents',
      kind: 'steam',
      path: path.join(documentsDir(), 'inZOI', 'SaveGames')
    }
  ]
}

async function canReadFolder(folder: string): Promise<{ exists: boolean; readable: boolean }> {
  try {
    const stat = await fs.stat(folder)
    if (!stat.isDirectory()) return { exists: false, readable: false }
  } catch {
    return { exists: false, readable: false }
  }
  try {
    await fs.readdir(folder)
    return { exists: true, readable: true }
  } catch {
    return { exists: true, readable: false }
  }
}

async function latestChildMtime(folder: string): Promise<number> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true })
    let latest = 0
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      try {
        const stat = await fs.stat(path.join(folder, entry.name))
        if (stat.mtimeMs > latest) latest = stat.mtimeMs
      } catch {
        /* ignore unreadable child */
      }
    }
    return latest
  } catch {
    return 0
  }
}

export async function listCandidates(
  specs: CandidateSpec[],
  extraCustom?: string | null
): Promise<SaveFolderCandidate[]> {
  const result: SaveFolderCandidate[] = []
  for (const spec of specs) {
    const access = await canReadFolder(spec.path)
    result.push({ ...spec, ...access })
  }
  if (extraCustom && !result.some((candidate) => path.resolve(candidate.path) === path.resolve(extraCustom))) {
    const access = await canReadFolder(extraCustom)
    result.push({
      id: 'custom',
      label: 'Custom folder',
      kind: 'custom',
      path: extraCustom,
      ...access
    })
  }
  return result
}

async function pickBestCandidate(
  candidates: SaveFolderCandidate[],
  fallbackPath: string | null
): Promise<SaveFolderCandidate | null> {
  const readable = candidates.filter((candidate) => candidate.exists && candidate.readable)
  if (readable.length > 0) {
    let best = readable[0]
    let bestMtime = -1
    for (const candidate of readable) {
      const mtime = await latestChildMtime(candidate.path)
      if (mtime > bestMtime) {
        best = candidate
        bestMtime = mtime
      }
    }
    return best
  }
  const existing = candidates.find((candidate) => candidate.exists)
  if (existing) return existing
  if (fallbackPath) {
    const fallback = candidates.find((candidate) => candidate.path === fallbackPath)
    if (fallback) return fallback
  }
  return candidates[0] ?? null
}

export interface ResolvedFolder {
  state: SaveFolderState
  candidate: SaveFolderCandidate | null
}

export async function resolveSource(settings: AppSettings): Promise<ResolvedFolder> {
  const specs = candidateSpecs()
  const candidates = await listCandidates(specs, settings.sourceFolder)
  const custom = settings.sourceFolder
    ? candidates.find((candidate) => candidate.id === 'custom') ?? null
    : null
  const pick = custom ?? (await pickBestCandidate(candidates, null))

  if (!pick) {
    return {
      candidate: null,
      state: {
        path: null,
        exists: false,
        readable: false,
        permissionDenied: false,
        kind: 'unknown',
        label: 'No save folder',
        platform: currentPlatform(),
        candidates,
        error: 'No save folder detected.'
      }
    }
  }

  let permissionDenied = false
  let error: string | null = null
  if (!pick.exists) {
    error = 'inZOI save folder not found.'
  } else if (!pick.readable) {
    permissionDenied = true
    error =
      process.platform === 'darwin'
        ? 'macOS is blocking access to this folder. Grant Full Disk Access to continue.'
        : 'This folder is not readable. Check its permissions and try again.'
  }

  return {
    candidate: pick,
    state: {
      path: pick.path,
      exists: pick.exists,
      readable: pick.readable,
      permissionDenied,
      kind: pick.kind,
      label: pick.label,
      platform: currentPlatform(),
      candidates,
      error
    }
  }
}

export async function resolveLocalDestination(settings: AppSettings): Promise<{
  path: string | null
  exists: boolean
  readable: boolean
  candidate: SaveFolderCandidate | null
}> {
  if (settings.destinationFolder) {
    const access = await canReadFolder(settings.destinationFolder)
    return {
      path: settings.destinationFolder,
      exists: access.exists,
      readable: access.readable,
      candidate: {
        id: 'custom-destination',
        label: 'Custom folder',
        path: settings.destinationFolder,
        kind: 'custom',
        ...access
      }
    }
  }
  const candidates = await listCandidates(candidateSpecs())
  const pick = await pickBestCandidate(candidates, null)
  return {
    path: pick?.path ?? null,
    exists: pick?.exists ?? false,
    readable: pick?.readable ?? false,
    candidate: pick ?? null
  }
}

export async function folderStateForPath(
  folder: string,
  label: string,
  kind: SaveKind
): Promise<SaveFolderState> {
  const access = await canReadFolder(folder)
  let permissionDenied = false
  let error: string | null = null
  if (!access.exists) error = 'That folder does not exist.'
  else if (!access.readable) {
    permissionDenied = true
    error =
      process.platform === 'darwin'
        ? 'macOS is blocking access to this folder. Grant Full Disk Access to continue.'
        : 'This folder is not readable. Check its permissions and try again.'
  }
  return {
    path: folder,
    exists: access.exists,
    readable: access.readable,
    permissionDenied,
    kind,
    label,
    platform: currentPlatform(),
    candidates: await listCandidates(candidateSpecs(), folder),
    error
  }
}

export async function pickCandidateById(candidateId: string, settings: AppSettings): Promise<
  SaveFolderCandidate | null
> {
  const candidates = await listCandidates(candidateSpecs(), settings.sourceFolder)
  return candidates.find((candidate) => candidate.id === candidateId) ?? null
}

export function localIPv4Addresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        addresses.push(entry.address)
      }
    }
  }
  return [...new Set(addresses)]
}

export const FULL_DISK_ACCESS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
