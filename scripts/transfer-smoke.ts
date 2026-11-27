import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { PROTOCOL } from '@shared/constants'
import type { Peer, SaveEntry, TransferProgress, TransferRecord } from '@shared/types'
import { scanSaveEntries } from '../src/main/saves'
import { sendSaves } from '../src/main/sender'
import { ReceiverServer } from '../src/main/server'

const folderName = '20260102-030405'

async function listBackups(root: string): Promise<string[]> {
  const found: string[] = []
  async function walk(folder: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) found.push(full)
    }
  }
  await walk(root)
  return found
}

function postJson(port: number, pathname: string, payload: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload))
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': body.length }
      },
      (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode ?? 0))
      }
    )
    request.on('error', reject)
    request.end(body)
  })
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inzoi-bridge-test-'))
  const sourceRoot = path.join(root, 'source', 'SaveGames')
  const destRoot = path.join(root, 'destination', 'SaveGames')
  const savePath = path.join(sourceRoot, folderName)
  const metadata = {
    FolderName: folderName,
    FileName: folderName,
    SaveType: 'Save',
    GameVersion: 340721,
    CharacterFirstName: 'Mia',
    CharacterLastName: 'Chen',
    MapName: 'BlissBay_Map',
    SavedTime: '2026.01.02-03.04.05'
  }

  try {
    await fs.mkdir(path.join(savePath, 'Portrait'), { recursive: true })
    await fs.writeFile(
      path.join(savePath, `${folderName}.usvx`),
      Buffer.concat([Buffer.from('IZMS-test-headerIZTB'), Buffer.from(JSON.stringify(metadata))])
    )
    await fs.writeFile(path.join(savePath, 'Portrait', 'portrait.png'), Buffer.alloc(64 * 1024, 7))

    const scanned = await scanSaveEntries(sourceRoot)
    assert.equal(scanned.length, 1, 'one save should be discovered')
    assert.equal(scanned[0].title, 'Mia Chen')
    assert.equal(scanned[0].world, 'Bliss Bay')
    assert.equal(scanned[0].folderName, folderName)
    console.log('✓ save scanning and metadata parsing')

    await fs.mkdir(path.join(destRoot, folderName), { recursive: true })
    await fs.writeFile(path.join(destRoot, folderName, 'old-save.txt'), 'old save')

    const progress: TransferProgress[] = []
    const completed: TransferRecord[] = []
    const server = new ReceiverServer({
      info: () => ({
        app: 'inzoi-save-bridge',
        protocol: PROTOCOL,
        instanceId: 'test-receiver',
        name: 'Test PC',
        platform: 'win32',
        savesPath: destRoot,
        version: '1.0.0',
        accepting: true
      }),
      askBeforeAccepting: () => false,
      requestAcceptance: async () => ({ accept: true, backup: true }),
      getDestination: async () => destRoot,
      onProgress: (event) => progress.push(event),
      onCompleted: (record) => completed.push(record),
      log: (message) => console.log(`[server] ${message}`)
    })

    const port = await server.start(49990)
    const peer: Peer = {
      instanceId: 'test-receiver',
      name: 'Test PC',
      platform: 'win32',
      osVersion: 'Windows 11',
      host: '127.0.0.1',
      port,
      savesPath: destRoot,
      version: '1.0.0',
      accepting: true,
      manual: true,
      lastSeen: Date.now()
    }

    const save: SaveEntry = {
      ...scanned[0],
      id: scanned[0].folderName,
      path: savePath
    }

    const outcome = await sendSaves({
      peer,
      saves: [save],
      backup: true,
      identity: { instanceId: 'test-sender', name: 'Test Mac', platform: 'darwin' },
      signal: new AbortController().signal,
      onProgress: () => undefined,
      log: (message) => console.log(`[sender] ${message}`)
    })

    assert.equal(outcome.ok, true, outcome.record.error ?? 'transfer should succeed')
    assert.equal(outcome.record.status, 'completed')
    assert.equal(completed.length, 1, 'receiver should record the transfer')

    const installed = await fs.readFile(path.join(destRoot, folderName, `${folderName}.usvx`))
    assert.ok(installed.byteLength > 0, 'save should be installed')
    assert.equal(
      await fs.stat(path.join(destRoot, folderName, 'Portrait', 'portrait.png')).then(
        (stat) => stat.size
      ),
      64 * 1024,
      'portrait should be copied'
    )

    const backups = await listBackups(path.join(destRoot, '.inzoi-save-bridge-backups'))
    assert.ok(
      backups.some((file) => file.endsWith(path.join(folderName, 'old-save.txt'))),
      'existing save should be backed up'
    )
    await fs.stat(path.join(savePath, `${folderName}.usvx`))
    console.log('✓ end-to-end local transfer, replacement, and backup')

    const traversalStatus = await postJson(port, '/api/prepare', {
      protocol: PROTOCOL,
      transferId: '12345678-abcd',
      sender: { instanceId: 'evil', name: 'Evil', platform: 'win32' },
      saveNames: [folderName],
      files: [{ path: `../outside.txt`, size: 1 }],
      totalBytes: 1,
      fileCount: 1,
      backup: false
    })
    assert.equal(traversalStatus, 400, 'path traversal must be rejected')
    console.log('✓ unsafe paths rejected')

    assert.ok(progress.some((event) => event.status === 'completed'))
    server.stop()
    console.log('\nAll transfer smoke tests passed.')
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
