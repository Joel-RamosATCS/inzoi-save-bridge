import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_TRANSFER_PORT } from '@shared/constants'
import type { AppSettings, TransferRecord } from '@shared/types'
import { defaultDeviceName, platformLabel, currentPlatform } from './paths'

const SETTINGS_FILE = 'settings.json'
const HISTORY_FILE = 'history.json'
const MAX_HISTORY = 250

function defaultSettings(): AppSettings {
  return {
    deviceName: defaultDeviceName(),
    sourceFolder: null,
    destinationFolder: null,
    backupBeforeReplacing: true,
    askBeforeAccepting: true,
    theme: 'system',
    glassPreset: 'amethyst',
    glassIntensity: 'ultra',
    specularRim: true,
    ambientMotion: true,
    port: DEFAULT_TRANSFER_PORT,
    discoveryEnabled: true,
    manualPeerHost: null,
    manualPeerPort: null
  }
}

function sanitizeSettings(value: unknown): AppSettings {
  const defaults = defaultSettings()
  if (!value || typeof value !== 'object') return defaults
  const input = value as Record<string, unknown>
  const theme = input.theme
  const port = Number(input.port)
  return {
    deviceName:
      typeof input.deviceName === 'string' && input.deviceName.trim()
        ? input.deviceName.trim().slice(0, 60)
        : defaults.deviceName,
    sourceFolder:
      typeof input.sourceFolder === 'string' && input.sourceFolder.trim()
        ? input.sourceFolder
        : null,
    destinationFolder:
      typeof input.destinationFolder === 'string' && input.destinationFolder.trim()
        ? input.destinationFolder
        : null,
    backupBeforeReplacing:
      typeof input.backupBeforeReplacing === 'boolean'
        ? input.backupBeforeReplacing
        : defaults.backupBeforeReplacing,
    askBeforeAccepting:
      typeof input.askBeforeAccepting === 'boolean'
        ? input.askBeforeAccepting
        : defaults.askBeforeAccepting,
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : defaults.theme,
    glassPreset:
      input.glassPreset === 'amethyst' ||
      input.glassPreset === 'emerald' ||
      input.glassPreset === 'aurora' ||
      input.glassPreset === 'obsidian'
        ? input.glassPreset
        : defaults.glassPreset,
    glassIntensity:
      input.glassIntensity === 'subtle' ||
      input.glassIntensity === 'balanced' ||
      input.glassIntensity === 'ultra'
        ? input.glassIntensity
        : defaults.glassIntensity,
    specularRim:
      typeof input.specularRim === 'boolean' ? input.specularRim : defaults.specularRim,
    ambientMotion:
      typeof input.ambientMotion === 'boolean' ? input.ambientMotion : defaults.ambientMotion,
    port:
      Number.isInteger(port) && port >= 1024 && port <= 65535
        ? port
        : DEFAULT_TRANSFER_PORT,
    discoveryEnabled:
      typeof input.discoveryEnabled === 'boolean'
        ? input.discoveryEnabled
        : defaults.discoveryEnabled,
    manualPeerHost:
      typeof input.manualPeerHost === 'string' && input.manualPeerHost.trim()
        ? input.manualPeerHost.trim()
        : null,
    manualPeerPort:
      Number.isInteger(Number(input.manualPeerPort)) &&
      Number(input.manualPeerPort) > 0 &&
      Number(input.manualPeerPort) <= 65535
        ? Number(input.manualPeerPort)
        : null
  }
}

function sanitizeHistory(value: unknown): TransferRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((record): record is TransferRecord => {
      if (!record || typeof record !== 'object') return false
      const item = record as Record<string, unknown>
      return (
        typeof item.id === 'string' &&
        typeof item.at === 'number' &&
        Array.isArray(item.saveNames) &&
        typeof item.totalBytes === 'number'
      )
    })
    .slice(0, MAX_HISTORY)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(temp, file)
}

export class Store {
  private settings: AppSettings = defaultSettings()
  private history: TransferRecord[] = []
  private settingsPath = ''
  private historyPath = ''
  private saveTimer: NodeJS.Timeout | null = null

  async init(): Promise<void> {
    const dir = app.getPath('userData')
    await fs.mkdir(dir, { recursive: true })
    this.settingsPath = path.join(dir, SETTINGS_FILE)
    this.historyPath = path.join(dir, HISTORY_FILE)
    this.settings = sanitizeSettings(await readJson(this.settingsPath))
    this.history = sanitizeHistory(await readJson(this.historyPath))
  }

  get dataDir(): string {
    return app.getPath('userData')
  }

  get platformDescription(): string {
    return `${platformLabel(currentPlatform())} device`
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = sanitizeSettings({ ...this.settings, ...patch })
    await writeJsonAtomic(this.settingsPath, this.settings)
    return this.getSettings()
  }

  getHistory(): TransferRecord[] {
    return [...this.history]
  }

  addHistory(record: TransferRecord): TransferRecord[] {
    this.history = [record, ...this.history].slice(0, MAX_HISTORY)
    this.scheduleHistoryWrite()
    return this.getHistory()
  }

  async clearHistory(): Promise<TransferRecord[]> {
    this.history = []
    await writeJsonAtomic(this.historyPath, this.history)
    return []
  }

  private scheduleHistoryWrite(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void writeJsonAtomic(this.historyPath, this.history).catch(() => undefined)
    }, 120)
  }
}
