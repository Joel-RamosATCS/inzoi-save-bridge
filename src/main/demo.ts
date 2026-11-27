import type { Peer, SaveEntry, SaveFolderState, TransferRecord } from '@shared/types'

const MB = 1024 * 1024

function hoursAgo(hours: number): number {
  return Date.now() - hours * 60 * 60 * 1000
}

export function demoSaves(source: SaveFolderState): SaveEntry[] {
  return [
    {
      id: 'demo-park',
      folderName: '20261118-043207',
      path: source.path ?? '/demo/20261118-043207',
      title: 'The Park household',
      world: 'Dowon',
      characterName: 'Mina Park',
      modifiedAt: hoursAgo(3),
      sizeBytes: 248 * MB,
      fileCount: 142,
      gameVersion: '340721',
      saveType: 'Save',
      accent: 'lavender',
      metadataFound: true,
      fingerprint: 'a8f14c90e12b7d03'
    },
    {
      id: 'demo-bliss',
      folderName: '20261116-211503',
      path: source.path ?? '/demo/20261116-211503',
      title: 'A new life in Bliss Bay',
      world: 'Bliss Bay',
      characterName: 'Nora Bell',
      modifiedAt: hoursAgo(27),
      sizeBytes: 186 * MB,
      fileCount: 96,
      gameVersion: '340721',
      saveType: 'Save',
      accent: 'butter',
      metadataFound: true,
      fingerprint: '73c41e09b52a18f4'
    },
    {
      id: 'demo-weekend',
      folderName: '20261114-183012',
      path: source.path ?? '/demo/20261114-183012',
      title: 'Weekend in Dowon',
      world: 'Dowon',
      characterName: 'Mina Park',
      modifiedAt: hoursAgo(78),
      sizeBytes: 124 * MB,
      fileCount: 71,
      gameVersion: '340721',
      saveType: 'AutoSave',
      accent: 'blush',
      metadataFound: true,
      fingerprint: 'c9103f7a44d82e11'
    }
  ]
}

export function demoPeers(): Peer[] {
  return [
    {
      instanceId: 'demo-windows-pc',
      name: "Alex's gaming PC",
      platform: 'win32',
      osVersion: 'Windows 11',
      host: '192.168.1.24',
      port: 47772,
      savesPath: 'C:\\Users\\Alex\\Documents\\inZOI\\SaveGames',
      version: '1.0.0',
      accepting: true,
      manual: false,
      lastSeen: Date.now(),
      rttMs: 3.4
    }
  ]
}

export function demoHistory(): TransferRecord[] {
  return [
    {
      id: 'demo-history-1',
      at: hoursAgo(30),
      direction: 'outgoing',
      peerName: "Alex's gaming PC",
      peerPlatform: 'win32',
      saveNames: ['20261115-094512'],
      totalBytes: 212 * MB,
      fileCount: 118,
      folderPath: 'C:\\Users\\Alex\\Documents\\inZOI\\SaveGames',
      status: 'completed',
      error: null
    },
    {
      id: 'demo-history-2',
      at: hoursAgo(120),
      direction: 'incoming',
      peerName: 'Studio PC',
      peerPlatform: 'win32',
      saveNames: ['20261109-172244', '20261109-181102'],
      totalBytes: 340 * MB,
      fileCount: 203,
      folderPath: '/Users/alex/Documents/inZOI/SaveGames',
      status: 'completed',
      error: null
    }
  ]
}
