import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(root, 'build')
const sourceSvg = path.join(buildDir, 'icon.svg')
const masterPng = path.join(buildDir, 'icon.svg.png')
const iconset = path.join(buildDir, 'icon.iconset')

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

if (!existsSync(sourceSvg)) {
  console.error('Missing build/icon.svg')
  process.exit(1)
}

if (!existsSync(masterPng)) {
  if (process.platform !== 'darwin') {
    console.error('Open build/icon.svg in a browser and export build/icon.svg.png at 1024×1024 first.')
    process.exit(1)
  }
  run('qlmanage', ['-t', '-s', '1024', '-o', buildDir, sourceSvg])
}

if (process.platform !== 'darwin') {
  console.log('PNG is ready. .icns and .ico must be generated on macOS or with a cross-platform icon tool.')
  process.exit(0)
}

writeFileSync(path.join(buildDir, 'icon.png'), readFileSync(masterPng))

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

const sizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

for (const [name, size] of sizes) {
  run('sips', ['-z', String(size), String(size), masterPng, '--out', path.join(iconset, name)])
}

run('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')])

const icoPng = path.join(buildDir, 'icon-256.png')
run('sips', ['-z', '256', '256', masterPng, '--out', icoPng])
const png = readFileSync(icoPng)
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
header.writeUInt8(0, 6)
header.writeUInt8(0, 7)
header.writeUInt8(0, 8)
header.writeUInt8(0, 9)
header.writeUInt16LE(1, 10)
header.writeUInt16LE(32, 12)
header.writeUInt32LE(png.length, 14)
header.writeUInt32LE(22, 18)
writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, png]))
rmSync(icoPng, { force: true })
rmSync(iconset, { recursive: true, force: true })

console.log('Wrote build/icon.png, build/icon.icns, and build/icon.ico')
