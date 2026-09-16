import { spawn, spawnSync } from 'node:child_process'
import { resolve, dirname, delimiter } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('This demo requires Node.js 24 LTS. Install it from https://nodejs.org/en/download and reopen your terminal.')
  process.exit(1)
}
if (process.argv.includes('--check')) {
  console.log(`Node ${process.version}: ready. Project: ${root}`)
  process.exit(0)
}
const npmCli = [process.env.npm_execpath, ...(process.env.PATH || '').split(delimiter).map(directory => resolve(directory, process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'npm'))].find(candidate => candidate && existsSync(candidate))
if (!npmCli) throw new Error('npm was not found. Install Node.js 24 with npm.')
for (const args of [['ci', '--no-audit', '--no-fund', '--cache', '.runtime/npm-cache'], ['run', 'build']]) {
  console.log(`\nRunning npm ${args.join(' ')} ...`)
  const result = spawnSync(process.execPath, [realpathSync(npmCli), ...args], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PATH: dirname(process.execPath) + delimiter + (process.env.PATH || '') },
  })
  if (result.error || result.status !== 0) {
    console.error('Setup failed. Keep this window open and check the error above.')
    process.exit(1)
  }
}
const { createOfficeServer } = await import('../server/office-server.mjs')
// Local-only rules demo. It does not change any production database or model settings.
const server = createOfficeServer({
  defaultMode: 'rules',
  dbPath: resolve(root, process.argv.includes('--verify') ? '.runtime/local-launch-verification/office.sqlite' : '.office-data/local-demo/office.sqlite'),
})
const port = Number(process.env.OFFICE_LOCAL_PORT || 5194)
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('OFFICE_LOCAL_PORT must be an integer between 1024 and 65535.')
  process.exit(1)
}
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is busy. Close the previous demo window and try again.`
    : error.message)
  process.exit(1)
})
server.listen(port, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${port}/office`
  console.log(`\nDEMO READY: ${url}\nRules demo; no model key needed. Keep this window open. Press Ctrl+C to stop.\n`)
  if (process.argv.includes('--verify')) {
    try {
      const page = await fetch(url)
      if (page.status !== 200 || !(await page.text()).includes('<html')) throw new Error('Built frontend did not respond.')
      const response = await fetch(`http://127.0.0.1:${port}/api/office/snapshot`)
      const cookie = response.headers.get('set-cookie')?.split(';')[0]
      if (response.status !== 200 || (await response.json()).state.matter.id !== 'SUP-001') throw new Error('Backend snapshot failed.')
      const model = await fetch(`http://127.0.0.1:${port}/api/office/model`, { headers: { Cookie: cookie } })
      if ((await model.json()).mode !== 'rules') throw new Error('Expected explicit rules mode.')
      console.log('PASS: built frontend + backend + rules mode, no model key required.')
      server.close(() => { process.exitCode = 0 })
    } catch (error) {
      console.error(error.message)
      server.close(() => { process.exitCode = 1 })
    }
    return
  }
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => console.log(`Open this address manually: ${url}`))
    child.unref()
  }
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { process.exitCode = 0 }))
