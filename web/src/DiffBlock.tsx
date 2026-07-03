import { useEffect, useRef, useState } from 'react'
import type { FileDiffOptions } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { ChangedFile } from '../../shared/types'
import type { DiffEntry, Tier } from './useReview'

interface DiffBlockProps {
  file: ChangedFile
  tier: Tier
  entry: DiffEntry | undefined
  requestDiff: (path: string, force?: boolean) => void
  options: FileDiffOptions<undefined>
}

function useNearViewport(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    if (near) return
    const el = ref.current
    if (el == null || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: '900px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [near])
  return [ref, near]
}

function statusBadge(file: ChangedFile) {
  if (file.binary) return <span className="file-badge bin">BINARY</span>
  switch (file.status) {
    case 'added':
      return <span className="file-badge new">NEW</span>
    case 'deleted':
      return <span className="file-badge del">DELETED</span>
    case 'renamed':
      return <span className="file-badge ren">RENAMED</span>
    default:
      return null
  }
}

function hiddenSummary(file: ChangedFile, tier: Tier): string {
  if (file.status === 'deleted') {
    return `Deleted file — ${file.deletions.toLocaleString()} lines removed`
  }
  const changed = file.additions + file.deletions
  return `${tier === 'noise' ? 'Marked as noise' : 'Hidden'} — ${changed.toLocaleString()} changed line${changed === 1 ? '' : 's'} hidden`
}

export default function DiffBlock({ file, tier, entry, requestDiff, options }: DiffBlockProps) {
  const [hidden, setHidden] = useState(
    !file.binary && (tier === 'noise' || file.status === 'deleted'),
  )
  const [collapsed, setCollapsed] = useState(false)
  const [hostRef, near] = useNearViewport()

  const wantsDiff = near && !hidden && !file.binary && !collapsed
  useEffect(() => {
    if (wantsDiff) requestDiff(file.path)
  }, [wantsDiff, file.path, requestDiff])

  const parts = file.path.split('/')
  const name = parts.pop()!

  let body: React.ReactNode
  if (file.binary) {
    body = (
      <div className="noise-body">
        <span>Binary file — no textual diff to display.</span>
      </div>
    )
  } else if (hidden) {
    body = (
      <div className="noise-body">
        <span>{hiddenSummary(file, tier)}</span>
        <button className="show-anyway" onClick={() => setHidden(false)}>
          Show anyway
        </button>
      </div>
    )
  } else if (entry == null || entry.status === 'loading') {
    const estimate = Math.min(80 + (file.additions + file.deletions) * 20, 420)
    body = <div className="diff-placeholder" style={{ height: estimate }} />
  } else if (entry.status === 'error') {
    body = (
      <div className="noise-body">
        <span>Failed to load this diff ({entry.message}).</span>
        <button className="show-anyway" onClick={() => requestDiff(file.path, true)}>
          Retry
        </button>
      </div>
    )
  } else if (entry.status === 'empty') {
    body = (
      <div className="noise-body">
        <span>No textual changes to display.</span>
      </div>
    )
  } else {
    body = <FileDiff fileDiff={entry.fileDiff} options={options} />
  }

  return (
    <div
      ref={hostRef}
      className={`diff-card${collapsed ? ' collapsed' : ''}`}
      data-path={file.path}
    >
      <button className="diff-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="chev">▼</span>
        <span className="diff-path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {parts.length > 0 && <span className="dir">{parts.join('/')}/</span>}
          {name}
        </span>
        {statusBadge(file)}
        <span className="diff-stats">
          <span className="stat-add">+{file.additions.toLocaleString()}</span>{' '}
          <span className="stat-del">−{file.deletions.toLocaleString()}</span>
        </span>
      </button>
      <div className="diff-body">{body}</div>
    </div>
  )
}
