import { git, type DiffRange } from './git.ts'

interface PrView {
  number: number
  title: string
  url: string
  baseRefName: string
  headRefName: string
  headRefOid: string
}

async function gh(cwd: string, args: string[]): Promise<string> {
  const spawn = () => Bun.spawn(['gh', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  let proc: ReturnType<typeof spawn>
  try {
    proc = spawn()
  } catch {
    throw new Error('the GitHub CLI (gh) is required for --pr but was not found on PATH. Install it from https://cli.github.com')
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `gh ${args.join(' ')} failed (${exitCode})`)
  }
  return stdout
}

/**
 * Find a configured remote pointing at the PR's base repo, so the fetch uses the
 * user's own auth (ssh/https) instead of an anonymous URL fetch. Falls back to
 * the repo URL from the PR when no remote matches.
 */
async function baseRepoRemote(repoRoot: string, prUrl: string): Promise<string> {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//i)
  if (!match) return prUrl.replace(/\/pull\/\d+.*$/, '')
  const [, owner, repo] = match
  const remotePattern = new RegExp(`github\\.com[:/]${owner}/${repo}(\\.git)?\\s`, 'i')
  const remotes = await git(repoRoot, ['remote', '-v'])
  for (const line of remotes.split('\n')) {
    if (remotePattern.test(line)) return line.split('\t')[0]
  }
  return `https://github.com/${owner}/${repo}`
}

export async function resolvePrRange(repoRoot: string, prArg: string): Promise<DiffRange> {
  const raw = await gh(repoRoot, [
    'pr', 'view', prArg,
    '--json', 'number,title,url,baseRefName,headRefName,headRefOid',
  ])
  const pr = JSON.parse(raw) as PrView

  const remote = await baseRepoRemote(repoRoot, pr.url)
  await git(repoRoot, ['fetch', '--quiet', remote, `refs/pull/${pr.number}/head`])
  const headSha = (await git(repoRoot, ['rev-parse', 'FETCH_HEAD'])).trim()
  await git(repoRoot, ['fetch', '--quiet', remote, `refs/heads/${pr.baseRefName}`])
  const baseSha = (await git(repoRoot, ['rev-parse', 'FETCH_HEAD'])).trim()

  return {
    args: ['--merge-base', baseSha, headSha],
    baseRef: pr.baseRefName,
    headRef: `#${pr.number} ${pr.headRefName}`,
  }
}
