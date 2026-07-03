import { $ } from 'bun'
import { rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO = '/private/tmp/claude-501/-Users-linminphyo-code-personal-tools-guided-review/9fcf794a-275c-4ab9-b2bd-84ea0b101009/scratchpad/fixture-repo'

async function write(rel: string, content: string) {
  const abs = join(REPO, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content)
}

async function main() {
  await rm(REPO, { recursive: true, force: true })
  await mkdir(REPO, { recursive: true })
  const git = $.cwd(REPO)

  await git`git init -q -b main`
  await git`git config user.email fixture@example.com`
  await git`git config user.name Fixture`

  // ---- initial commit on main ----
  await write('src/app.ts', 'export function app() {\n  return "hello"\n}\n')
  await write('src/config.ts', 'export const capacity = 10\n')
  await write('src/old-name.ts', 'export const renameMe = true\n')
  await write('src/legacy.ts', 'export const legacy = "delete me"\n')
  await write('README.md', '# Fixture\n\nInitial readme.\n')
  await write('package-lock.json', JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }, null, 2) + '\n')
  await git`git add -A`
  await git`git commit -qm ${'initial commit'}`

  // ---- feature branch ----
  await git`git checkout -q -b feature`

  // modify
  await write('src/app.ts', 'import { rateLimit } from "./middleware/rateLimit"\n\nexport function app() {\n  rateLimit()\n  return "hello, rate-limited world"\n}\n')
  await write('src/config.ts', 'export const capacity = 60\nexport const refillPerSecond = 10\n')
  await write('README.md', '# Fixture\n\nInitial readme.\n\nNow with rate limiting.\n')
  await write('package-lock.json', JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { 'node_modules/token-bucket': { version: '1.0.0' } } }, null, 2) + '\n')

  // add
  await write('src/lib/limiter.ts', 'export class TokenBucket {\n  constructor(public capacity: number) {}\n  tryConsume() {\n    return this.capacity > 0\n  }\n}\n')
  await write('src/middleware/rateLimit.ts', 'import { TokenBucket } from "../lib/limiter"\n\nexport function rateLimit() {\n  const bucket = new TokenBucket(60)\n  return bucket.tryConsume()\n}\n')
  await write('test/limiter.test.ts', 'import { TokenBucket } from "../src/lib/limiter"\n\ntest("consumes", () => {\n  expect(new TokenBucket(1).tryConsume()).toBe(true)\n})\n')

  // rename (pure rename -> R100)
  await git`git mv src/old-name.ts src/new-name.ts`

  // delete
  await git`git rm -q src/legacy.ts`

  // binary (a tiny PNG)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await mkdir(join(REPO, 'assets'), { recursive: true })
  await writeFile(join(REPO, 'assets/logo.png'), png)

  await git`git add -A`
  await git`git commit -qm ${'add rate limiting'}`

  // ---- guide.json (references some files; leaves README.md and assets/logo.png unreferenced) ----
  const guide = {
    version: 1,
    title: 'Per-key rate limiting via token bucket',
    summary: 'Adds an in-memory token-bucket limiter and wires it into the request path. README and a logo asset are intentionally left unreferenced to exercise the Everything-else bucket.',
    sections: [
      {
        id: 'limiter',
        title: 'Token bucket limiter',
        signal: 'core',
        explanation: 'The core of the change. `TokenBucket` tracks capacity and is trivially testable. Scrutinize the (currently trivial) consume logic.',
        refs: [{ file: 'src/lib/limiter.ts' }],
        insights: [{ kind: 'risk', text: 'Buckets live in process memory; multi-instance deployments limit per instance, not globally.' }],
      },
      {
        id: 'wiring',
        title: 'Middleware & app wiring',
        signal: 'core',
        explanation: 'The middleware creates a bucket and the app mounts it. Ordering is intentional.',
        refs: [
          { file: 'src/middleware/rateLimit.ts' },
          { file: 'src/app.ts', lines: [1, 5] },
        ],
        insights: [{ kind: 'note', text: 'rateLimit() now runs before the return in app().' }],
      },
      {
        id: 'config',
        title: 'Configuration',
        signal: 'supporting',
        explanation: 'Capacity bumped to 60 with a refill rate. Verify defaults match ops expectations.',
        refs: [{ file: 'src/config.ts' }],
      },
      {
        id: 'housekeeping',
        title: 'Rename & delete',
        signal: 'supporting',
        explanation: 'Renamed the old helper and removed dead legacy code.',
        refs: [{ file: 'src/new-name.ts' }, { file: 'src/legacy.ts' }],
      },
      {
        id: 'tests',
        title: 'Tests',
        signal: 'supporting',
        explanation: 'A smoke test for the bucket.',
        refs: [{ file: 'test/limiter.test.ts' }],
        insights: [{ kind: 'test', text: 'Only a smoke test — no refill/exhaustion coverage yet.' }],
      },
      {
        id: 'noise',
        title: 'Lockfile',
        signal: 'noise',
        explanation: 'Dependency bump. Nothing hand-written.',
        refs: [{ file: 'package-lock.json' }],
      },
    ],
  }
  await writeFile(join(REPO, 'guide.json'), JSON.stringify(guide, null, 2) + '\n')

  console.log(`fixture repo ready at: ${REPO}`)
  console.log(`guide at:              ${join(REPO, 'guide.json')}`)
  console.log(`run: bun bin/guided-review.ts --base main --head feature --guide ${join(REPO, 'guide.json')} --no-open  (from ${REPO})`)
}

main()
