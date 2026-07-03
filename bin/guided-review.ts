#!/usr/bin/env bun
import { basename } from 'node:path'
import { startServer } from '../server/index.ts'
import { gitToplevel, resolveRef, type DiffRange } from '../server/git.ts'

interface Flags {
  base?: string
  head: string
  guide?: string
  port: number
  open: boolean
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { head: 'HEAD', port: 4400, open: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--base':
        flags.base = argv[++i]
        break
      case '--head':
        flags.head = argv[++i]
        break
      case '--guide':
        flags.guide = argv[++i]
        break
      case '--port':
        flags.port = parseInt(argv[++i], 10)
        break
      case '--no-open':
        flags.open = false
        break
      case '-h':
      case '--help':
        printUsage()
        process.exit(0)
      default:
        console.error(`guided-review: unknown argument "${arg}"`)
        printUsage()
        process.exit(1)
    }
  }
  if (Number.isNaN(flags.port) || flags.port <= 0) {
    console.error('guided-review: --port must be a positive number.')
    process.exit(1)
  }
  return flags
}

function printUsage() {
  console.error(
    `Usage: guided-review [options]

  --base <ref>    Base ref for the diff range (base...head). Omit to diff the working tree against HEAD.
  --head <ref>    Head ref. Default: HEAD.
  --guide <path>  Path to a guide JSON file. Omit for plain diff-viewer mode.
  --port <n>      Server port. Default: 4400.
  --no-open       Do not auto-open the browser.`,
  )
}

function openBrowser(targetUrl: string) {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    Bun.spawn([cmd, targetUrl], { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    console.error(`guided-review: could not open a browser automatically. Visit ${targetUrl}`)
  }
}

async function main() {
  const flags = parseFlags(Bun.argv.slice(2))
  const cwd = process.cwd()

  let repoRoot: string
  try {
    repoRoot = await gitToplevel(cwd)
  } catch {
    console.error('guided-review: not inside a git repository. Run this from within a git repo.')
    process.exit(1)
  }

  // Resolve refs early and fail fast with readable errors.
  let range: DiffRange
  if (flags.base) {
    try {
      await resolveRef(repoRoot, flags.base)
    } catch {
      console.error(`guided-review: base ref "${flags.base}" could not be resolved.`)
      process.exit(1)
    }
    try {
      await resolveRef(repoRoot, flags.head)
    } catch {
      console.error(`guided-review: head ref "${flags.head}" could not be resolved.`)
      process.exit(1)
    }
    range = {
      args: ['--merge-base', flags.base, flags.head],
      baseRef: flags.base,
      headRef: flags.head,
    }
  } else {
    // No base: diff the working tree against HEAD.
    try {
      await resolveRef(repoRoot, 'HEAD')
    } catch {
      console.error('guided-review: HEAD could not be resolved (does this repo have any commits?).')
      process.exit(1)
    }
    range = { args: ['HEAD'], baseRef: 'HEAD', headRef: 'working tree' }
  }

  let server: ReturnType<typeof startServer>
  try {
    server = startServer({
      repoRoot,
      repoName: basename(repoRoot),
      range,
      guidePath: flags.guide ?? null,
      port: flags.port,
    })
  } catch (err) {
    const message = (err as Error).message ?? ''
    if ((err as { code?: string }).code === 'EADDRINUSE' || /in use/i.test(message)) {
      console.error(`guided-review: port ${flags.port} is already in use — pass --port <n> to use a different port.`)
    } else {
      console.error(`guided-review: could not start server: ${message}`)
    }
    process.exit(1)
  }

  const targetUrl = `http://localhost:${server.port}`
  console.log(`guided-review: reviewing ${basename(repoRoot)} (${range.baseRef} → ${range.headRef})`)
  console.log(`guided-review: serving on ${targetUrl}`)
  if (flags.open) openBrowser(targetUrl)
}

main()
