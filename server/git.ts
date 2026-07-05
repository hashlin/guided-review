import type { ChangedFile, FileStatus } from '../shared/types.ts'

export interface DiffRange {
  /** git args that select the diff range, e.g. ['--merge-base', base, head] or ['HEAD'] */
  args: string[]
  baseRef: string
  headRef: string
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${exitCode}): ${stderr.trim()}`)
  }
  return stdout
}

export async function gitToplevel(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
}

export async function resolveRef(cwd: string, ref: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim()
}

function statusFromCode(code: string): FileStatus {
  const c = code[0]
  if (c === 'A') return 'added'
  if (c === 'D') return 'deleted'
  if (c === 'R') return 'renamed'
  return 'modified'
}

/**
 * Parse `git diff --name-status -z` output.
 * Records are NUL-separated. Normal: STATUS \0 PATH. Rename/copy: R100 \0 OLD \0 NEW.
 * Returns entries keyed by the new path.
 */
function parseNameStatus(raw: string): Map<string, { status: FileStatus; oldPath?: string }> {
  const out = new Map<string, { status: FileStatus; oldPath?: string }>()
  const parts = raw.split('\0')
  let i = 0
  while (i < parts.length) {
    const code = parts[i]
    if (!code) break
    i++
    const status = statusFromCode(code)
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = parts[i++]
      const newPath = parts[i++]
      out.set(newPath, { status, oldPath })
    } else {
      const path = parts[i++]
      out.set(path, { status })
    }
  }
  return out
}

/**
 * Parse `git diff --numstat -z` output.
 * Normal: ADD \t DEL \t PATH \0. Rename: ADD \t DEL \t \0 OLD \0 NEW \0 (path field empty,
 * old and new follow as their own NUL-terminated fields). Binary: ADD and DEL are '-'.
 * Returns counts keyed by the new path.
 */
function parseNumstat(raw: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const out = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  const parts = raw.split('\0')
  let i = 0
  while (i < parts.length) {
    const field = parts[i]
    if (!field) {
      i++
      continue
    }
    // field looks like "ADD\tDEL\tPATH" or "ADD\tDEL\t" (rename, path empty)
    const firstTab = field.indexOf('\t')
    const secondTab = field.indexOf('\t', firstTab + 1)
    const addStr = field.slice(0, firstTab)
    const delStr = field.slice(firstTab + 1, secondTab)
    const inlinePath = field.slice(secondTab + 1)
    const binary = addStr === '-' || delStr === '-'
    const additions = binary ? 0 : parseInt(addStr, 10)
    const deletions = binary ? 0 : parseInt(delStr, 10)
    i++
    let newPath: string
    if (inlinePath === '') {
      // rename/copy: next two fields are old then new path
      /* const oldPath = */ parts[i++]
      newPath = parts[i++]
    } else {
      newPath = inlinePath
    }
    out.set(newPath, { additions, deletions, binary })
  }
  return out
}

export async function getChangedFiles(cwd: string, range: DiffRange): Promise<ChangedFile[]> {
  const [nameStatusRaw, numstatRaw] = await Promise.all([
    git(cwd, ['diff', '-M', '--name-status', '-z', ...range.args]),
    git(cwd, ['diff', '-M', '--numstat', '-z', ...range.args]),
  ])
  const statuses = parseNameStatus(nameStatusRaw)
  const counts = parseNumstat(numstatRaw)

  const files: ChangedFile[] = []
  for (const [path, { status, oldPath }] of statuses) {
    const count = counts.get(path) ?? { additions: 0, deletions: 0, binary: false }
    const file: ChangedFile = {
      path,
      status,
      additions: count.additions,
      deletions: count.deletions,
      binary: count.binary,
    }
    if (oldPath) file.oldPath = oldPath
    files.push(file)
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

export async function getFileDiff(
  cwd: string,
  range: DiffRange,
  path: string,
  oldPath?: string,
): Promise<string> {
  // For renames, pass both paths so rename detection produces a rename diff rather
  // than an add of the new path.
  const pathspec = oldPath ? [oldPath, path] : [path]
  return git(cwd, ['diff', '-M', ...range.args, '--', ...pathspec])
}
