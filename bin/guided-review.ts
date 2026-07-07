#!/usr/bin/env bun
import { basename } from 'node:path'
import { startServer } from '../server/index.ts'
import { gitToplevel, resolveRef, type DiffRange } from '../server/git.ts'
import { resolvePrRange } from '../server/github.ts'

interface Flags {
  base?: string
  head?: string
  pr?: string
  guide?: string
  port: number
  open: boolean
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { port: 4400, open: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--base':
        flags.base = argv[++i]
        break
      case '--head':
        flags.head = argv[++i]
        break
      case '--pr':
        flags.pr = argv[++i]
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
  if (flags.pr && (flags.base || flags.head)) {
    console.error('guided-review: --pr cannot be combined with --base/--head.')
    process.exit(1)
  }
  return flags
}

function printUsage() {
  console.error(
    `Usage: guided-review [options]
       guided-review install-skills [--agent <name>...] [--yes]

  --base <ref>    Base ref for the diff range (base...head). Omit to diff the working tree against HEAD.
  --head <ref>    Head ref. Default: HEAD.
  --pr <n|url>    Review a GitHub pull request (number or URL) via the gh CLI. Excludes --base/--head.
  --guide <path>  Path to a guide JSON file. Omit for plain diff-viewer mode.
  --port <n>      Server port. Default: 4400.
  --no-open       Do not auto-open the browser.

  install-skills  Install the guided-review agent skill globally via the skills.sh CLI.`,
  )
}

const SKILLS_SOURCE = 'hashlin/guided-review'

function printInstallSkillsUsage() {
  console.error(
    `Usage: guided-review install-skills [options]

Install the guided-review agent skill globally (via "bun x skills add").
Without --agent, the skills CLI detects installed agents and prompts.

  --agent <name>  Target a specific agent (e.g. claude-code, codex). Repeatable.
  --yes, -y       Skip confirmation prompts.`,
  )
}

async function installSkills(argv: string[]): Promise<never> {
  const passthrough: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--agent': {
        const agent = argv[++i]
        if (!agent) {
          console.error('guided-review: --agent requires a value.')
          process.exit(1)
        }
        passthrough.push('--agent', agent)
        break
      }
      case '--yes':
      case '-y':
        passthrough.push('--yes')
        break
      case '-h':
      case '--help':
        printInstallSkillsUsage()
        process.exit(0)
      default:
        console.error(`guided-review: unknown argument "${arg}"`)
        printInstallSkillsUsage()
        process.exit(1)
    }
  }
  const proc = Bun.spawn(
    [process.execPath, 'x', 'skills', 'add', SKILLS_SOURCE, '--global', ...passthrough],
    { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
  )
  const code = await proc.exited
  if (code !== 0) {
    console.error(`guided-review: skill installation failed (exit code ${code}).`)
  }
  process.exit(code)
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
  const argv = Bun.argv.slice(2)
  if (argv[0] === 'install-skills') {
    await installSkills(argv.slice(1))
  }
  const flags = parseFlags(argv)
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
  if (flags.pr) {
    try {
      range = await resolvePrRange(repoRoot, flags.pr)
    } catch (err) {
      console.error(`guided-review: could not resolve PR "${flags.pr}": ${(err as Error).message}`)
      process.exit(1)
    }
  } else if (flags.base) {
    const head = flags.head ?? 'HEAD'
    try {
      await resolveRef(repoRoot, flags.base)
    } catch {
      console.error(`guided-review: base ref "${flags.base}" could not be resolved.`)
      process.exit(1)
    }
    try {
      await resolveRef(repoRoot, head)
    } catch {
      console.error(`guided-review: head ref "${head}" could not be resolved.`)
      process.exit(1)
    }
    range = {
      args: ['--merge-base', flags.base, head],
      baseRef: flags.base,
      headRef: head,
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
