import { join } from 'node:path'
import type { ReviewMeta } from '../shared/types.ts'
import { getChangedFiles, getFileDiff, type DiffRange } from './git.ts'
import { loadGuide } from './guide.ts'

export interface ServerConfig {
  repoRoot: string
  repoName: string
  range: DiffRange
  guidePath: string | null
  port: number
}

const DIST_DIR = join(import.meta.dir, '../web/dist')

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.woff2')) return 'font/woff2'
  if (path.endsWith('.map')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

export function startServer(config: ServerConfig) {
  const distIndex = Bun.file(join(DIST_DIR, 'index.html'))

  const server = Bun.serve({
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/api/review') {
        const [files, guide] = await Promise.all([
          getChangedFiles(config.repoRoot, config.range),
          config.guidePath ? loadGuide(config.guidePath) : Promise.resolve(null),
        ])
        const meta: ReviewMeta = {
          repo: config.repoName,
          baseRef: config.range.baseRef,
          headRef: config.range.headRef,
          files,
          guide,
        }
        return Response.json(meta, { headers: { 'Cache-Control': 'no-store' } })
      }

      if (url.pathname === '/api/diff') {
        const file = url.searchParams.get('file')
        if (!file) {
          return new Response('Missing file parameter', { status: 400, headers: { 'Cache-Control': 'no-store' } })
        }
        // Ground-truth guard: only serve diffs for files actually in the changed set,
        // so the server never leaks arbitrary repo content.
        const files = await getChangedFiles(config.repoRoot, config.range)
        const match = files.find((f) => f.path === file)
        if (!match) {
          return new Response('File is not part of this diff', { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const diff = await getFileDiff(config.repoRoot, config.range, file, match.oldPath)
        return new Response(diff, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      }

      if (url.pathname.startsWith('/api/')) {
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
      }

      // Static client (prod). SPA fallback to index.html.
      if (await distIndex.exists()) {
        if (url.pathname !== '/' && !url.pathname.includes('..')) {
          const asset = Bun.file(join(DIST_DIR, url.pathname))
          if (await asset.exists()) {
            return new Response(asset, { headers: { 'Content-Type': contentType(url.pathname) } })
          }
        }
        return new Response(distIndex, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }

      return new Response(
        'The client has not been built. Run the Vite dev server (bun run dev:web) and open that URL, ' +
          'or build it with `bun run build`.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      )
    },
  })

  return server
}

// Allow running the server standalone (e.g. `bun --watch server/index.ts`) for client dev.
// Diffs the working tree against HEAD in the current directory, no guide.
if (import.meta.main) {
  const { gitToplevel } = await import('./git.ts')
  const cwd = process.cwd()
  let repoRoot: string
  try {
    repoRoot = await gitToplevel(cwd)
  } catch {
    console.error('guided-review: not inside a git repository.')
    process.exit(1)
  }
  const server = startServer({
    repoRoot,
    repoName: repoRoot.split('/').pop() || repoRoot,
    range: { args: ['HEAD'], baseRef: 'HEAD', headRef: 'working tree' },
    guidePath: null,
    port: 4400,
  })
  console.log(`guided-review server listening on http://localhost:${server.port}`)
}
