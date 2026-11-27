import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import {
  DISCOVERY_INTERVAL_MS,
  DISCOVERY_MAGIC,
  DISCOVERY_PORT,
  PEER_TTL_MS,
  PROTOCOL
} from '@shared/constants'
import type { AppPlatform, Peer } from '@shared/types'

export interface Announcement {
  instanceId: string
  name: string
  platform: AppPlatform
  osVersion: string | null
  port: number
  savesPath: string | null
  version: string
  accepting: boolean
}

interface WireMessage {
  magic: string
  protocol: number
  instanceId: string
  name: string
  platform: AppPlatform
  osVersion: string | null
  port: number
  savesPath: string | null
  version: string
  accepting: boolean
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function intToIp(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function broadcastAddresses(): string[] {
  const addresses = new Set<string>(['255.255.255.255'])
  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (!entry.address || !entry.netmask) continue
      try {
        const address = ipToInt(entry.address)
        const mask = ipToInt(entry.netmask)
        const broadcast = (address | (~mask >>> 0)) >>> 0
        addresses.add(intToIp(broadcast))
      } catch {
        /* ignore malformed interface */
      }
    }
  }
  return [...addresses]
}

export class Discovery extends EventEmitter {
  private socket: dgram.Socket | null = null
  private announceTimer: NodeJS.Timeout | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private peers = new Map<string, Peer>()
  private started = false
  private announcementsDisabled = false

  constructor(
    private readonly getAnnouncement: () => Announcement,
    private readonly log: (message: string) => void = () => undefined
  ) {
    super()
  }

  start(): void {
    if (this.started) return
    this.started = true
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket
    socket.on('error', (error) => {
      this.log(`Discovery socket error: ${error.message}`)
      this.announcementsDisabled = true
    })
    socket.on('message', (message, rinfo) => this.handleMessage(message, rinfo.address))
    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true)
      } catch {
        /* not fatal */
      }
      this.emitAnnouncement()
      this.announceTimer = setInterval(() => this.emitAnnouncement(), DISCOVERY_INTERVAL_MS)
    })
    this.pruneTimer = setInterval(() => this.prune(), 4000)
  }

  stop(): void {
    this.started = false
    if (this.announceTimer) clearInterval(this.announceTimer)
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.announceTimer = null
    this.pruneTimer = null
    try {
      this.socket?.close()
    } catch {
      /* already closed */
    }
    this.socket = null
  }

  getPeers(): Peer[] {
    return [...this.peers.values()].sort((a, b) => {
      if (a.manual !== b.manual) return a.manual ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  upsertManualPeer(peer: Peer): Peer {
    this.peers.set(peer.instanceId, { ...peer, manual: true, lastSeen: Date.now() })
    this.notify()
    return peer
  }

  removePeer(instanceId: string): void {
    if (this.peers.delete(instanceId)) this.notify()
  }

  removeManualPeers(): void {
    let changed = false
    for (const [id, peer] of this.peers) {
      if (peer.manual) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.notify()
  }

  clearDiscoveredPeers(): void {
    let changed = false
    for (const [id, peer] of this.peers) {
      if (!peer.manual) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.notify()
  }

  private emitAnnouncement(): void {
    if (this.announcementsDisabled || !this.socket) return
    let announcement: Announcement
    try {
      announcement = this.getAnnouncement()
    } catch {
      return
    }
    const message: WireMessage = {
      magic: DISCOVERY_MAGIC,
      protocol: PROTOCOL,
      ...announcement
    }
    const payload = Buffer.from(JSON.stringify(message))
    for (const address of broadcastAddresses()) {
      this.socket.send(payload, DISCOVERY_PORT, address, () => undefined)
    }
  }

  private handleMessage(message: Buffer, address: string): void {
    let parsed: WireMessage
    try {
      parsed = JSON.parse(message.toString('utf8')) as WireMessage
    } catch {
      return
    }
    if (parsed.magic !== DISCOVERY_MAGIC || parsed.protocol !== PROTOCOL) return
    if (!parsed.instanceId || typeof parsed.instanceId !== 'string') return
    const self = this.getAnnouncement()
    if (parsed.instanceId === self.instanceId) return

    const existing = this.peers.get(parsed.instanceId)
    const peer: Peer = {
      instanceId: parsed.instanceId,
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 80) : 'Unknown device',
      platform: parsed.platform,
      osVersion: typeof parsed.osVersion === 'string' ? parsed.osVersion : null,
      host: address,
      port: Number(parsed.port) || 0,
      savesPath: typeof parsed.savesPath === 'string' ? parsed.savesPath : null,
      version: typeof parsed.version === 'string' ? parsed.version : '',
      accepting: Boolean(parsed.accepting),
      manual: existing?.manual ?? false,
      lastSeen: Date.now()
    }
    if (!existing?.manual) this.peers.set(parsed.instanceId, peer)

    const changed =
      !existing ||
      existing.name !== peer.name ||
      existing.host !== peer.host ||
      existing.port !== peer.port ||
      existing.savesPath !== peer.savesPath ||
      existing.accepting !== peer.accepting ||
      existing.lastSeen + 7000 < peer.lastSeen
    if (changed && !existing?.manual) this.notify()
  }

  private prune(): void {
    const cutoff = Date.now() - PEER_TTL_MS
    let changed = false
    for (const [id, peer] of this.peers) {
      if (peer.manual) continue
      if (peer.lastSeen < cutoff) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.notify()
  }

  private notify(): void {
    this.emit('peers', this.getPeers())
  }
}
