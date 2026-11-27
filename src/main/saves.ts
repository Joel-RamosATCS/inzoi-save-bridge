import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { EngineKind, SaveAccent, SaveEntry } from '@shared/types'
import { rustCollectSaveFiles, rustScanSaves } from './rust-bridge'

interface RawMetadata {
  HouseholdName?: unknown
  FamilyName?: unknown
  CharacterFirstName?: unknown
  CharacterLastName?: unknown
  MapName?: unknown
  SavedTime?: unknown
  SaveType?: unknown
  GameVersion?: unknown
  FolderName?: unknown
}

interface WalkResult {
  sizeBytes: number
  fileCount: number
  latestMtime: number
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function accentFor(value: string): SaveAccent {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  const accents: SaveAccent[] = ['lavender', 'butter', 'blush']
  return accents[Math.abs(hash) % accents.length]
}

function worldName(mapName: string | null): string {
  if (!mapName) return 'Unknown world'
  const base = mapName.replace(/_map$/i, '').replace(/^map_/i, '')
  const known: Record<string, string> = {
    redcity: 'Red City',
    blissbay: 'Bliss Bay',
    dowon: 'Dowon',
    cahaya: 'Cahaya'
  }
  const key = base.replace(/[^a-z]/gi, '').toLowerCase()
  if (known[key]) return known[key]
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSavedTime(value: string | null): number | null {
  if (!value) return null
  const match = value.match(
    /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/
  )
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

function extractJson(buffer: Buffer): string | null {
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
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

async function readUsvxMetadata(file: string): Promise<RawMetadata | null> {
  let handle: FileHandle | null = null
  try {
    handle = await fs.open(file, 'r')
    const buffer = Buffer.alloc(512 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const json = extractJson(buffer.subarray(0, bytesRead))
    if (!json) return null
    return JSON.parse(json) as RawMetadata
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function walkSaveFolder(folder: string): Promise<WalkResult> {
  const result: WalkResult = { sizeBytes: 0, fileCount: 0, latestMtime: 0 }
  const stack = [folder]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(full)
        result.sizeBytes += stat.size
        result.fileCount += 1
        if (stat.mtimeMs > result.latestMtime) result.latestMtime = stat.mtimeMs
      } catch {
        /* skip unreadable files */
      }
    }
  }
  return result
}

async function findMetadataFile(folder: string, folderName: string): Promise<string | null> {
  const direct = path.join(folder, `${folderName}.usvx`)
  try {
    const stat = await fs.stat(direct)
    if (stat.isFile()) return direct
  } catch {
    /* fall through */
  }
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.usvx'))
      .map((entry) => entry.name)
    if (candidates.length === 0) return null
    const primary =
      candidates.find((name) => !/autosave/i.test(name)) ?? candidates[0]
    return path.join(folder, primary)
  } catch {
    return null
  }
}

export async function scanSaveEntriesWithMetrics(
  folder: string
): Promise<{ saves: SaveEntry[]; engine: EngineKind; durationMs: number }> {
  const rustResult = await rustScanSaves(folder)
  if (rustResult) {
    return rustResult
  }

  const started = performance.now()
  let entries: Dirent[]
  try {
    entries = await fs.readdir(folder, { withFileTypes: true })
  } catch {
    return { saves: [], engine: 'node-fallback', durationMs: 0.1 }
  }

  const saves: SaveEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const savePath = path.join(folder, entry.name)
    try {
      const folderStat = await fs.stat(savePath)
      if (!folderStat.isDirectory()) continue
      const walk = await walkSaveFolder(savePath)
      const metadataFile = await findMetadataFile(savePath, entry.name)
      const metadata = metadataFile ? await readUsvxMetadata(metadataFile) : null

      const firstName = asString(metadata?.CharacterFirstName)
      const lastName = asString(metadata?.CharacterLastName)
      const household = asString(metadata?.HouseholdName) ?? asString(metadata?.FamilyName)
      const characterName = [firstName, lastName].filter(Boolean).join(' ') || null
      let title = characterName ?? entry.name
      if (household) {
        title = /household/i.test(household) ? household : `The ${household} household`
      } else if (characterName) {
        title = characterName
      }

      const savedTime = parseSavedTime(asString(metadata?.SavedTime))
      const modifiedAt = Math.max(
        savedTime ?? 0,
        walk.latestMtime,
        folderStat.mtimeMs
      )

      saves.push({
        id: entry.name,
        folderName: entry.name,
        path: savePath,
        title,
        world: worldName(asString(metadata?.MapName)),
        characterName,
        modifiedAt,
        sizeBytes: walk.sizeBytes,
        fileCount: walk.fileCount,
        gameVersion:
          typeof metadata?.GameVersion === 'number'
            ? String(metadata.GameVersion)
            : asString(metadata?.GameVersion),
        saveType: asString(metadata?.SaveType),
        accent: accentFor(entry.name),
        metadataFound: Boolean(metadata)
      })
    } catch {
      /* skip broken saves */
    }
  }

  saves.sort((a, b) => b.modifiedAt - a.modifiedAt)
  const durationMs = Math.max(0.1, Math.round((performance.now() - started) * 10) / 10)
  return { saves, engine: 'node-fallback', durationMs }
}

export async function scanSaveEntries(folder: string): Promise<SaveEntry[]> {
  const result = await scanSaveEntriesWithMetrics(folder)
  return result.saves
}

export interface CollectedSave {
  folderName: string
  path: string
  files: { path: string; size: number; mtimeMs: number }[]
  totalBytes: number
  fileCount: number
}

export async function collectSaveFiles(save: SaveEntry): Promise<CollectedSave> {
  const rustResult = await rustCollectSaveFiles(save.path)
  if (rustResult) {
    return {
      folderName: save.folderName,
      path: save.path,
      files: rustResult.files,
      totalBytes: rustResult.totalBytes,
      fileCount: rustResult.fileCount
    }
  }

  const files: CollectedSave['files'] = []
  const stack: string[] = [save.path]
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
        path: path.relative(save.path, full).split(path.sep).join('/'),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return {
    folderName: save.folderName,
    path: save.path,
    files,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    fileCount: files.length
  }
}

export function formatWorldName(mapName: string): string {
  return worldName(mapName)
}
