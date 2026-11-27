import type { AppPlatform } from '@shared/types'

const MB = 1024 * 1024
const GB = MB * 1024

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes >= GB) {
    const value = bytes / GB
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} GB`
  }
  if (bytes >= MB) return `${Math.max(1, Math.round(bytes / MB))} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatSaveDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  const now = new Date()
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
  if (isSameDay(date, now)) return `Today, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `Yesterday, ${time}`
  const day = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
  return `${day}, ${time}`
}

export function formatHistoryDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

export function platformName(platform: AppPlatform | undefined | null): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return 'Unknown'
}

export function deviceKindLabel(platform: AppPlatform | undefined | null): string {
  if (platform === 'darwin') return 'Mac'
  if (platform === 'win32') return 'Windows PC'
  return 'PC'
}

export function shortPath(folder: string, max = 54): string {
  if (folder.length <= max) return folder
  const parts = folder.split(/[\\/]/)
  if (parts.length <= 2) return folder
  return `…${folder.slice(-(max - 1))}`
}

export function friendlySaveName(name: string): string {
  const match = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  if (!match) return name
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (!Number.isFinite(date.getTime())) return name
  return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)} save`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'PC'
}
