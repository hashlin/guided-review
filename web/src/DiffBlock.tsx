import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AnnotationSide,
  DiffLineAnnotation,
  FileDiffMetadata,
  FileDiffOptions,
  SelectedLineRange,
} from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { ChangedFile } from '../../shared/types'
import type { DiffEntry, Tier } from './useReview'
import type { CommentSide, LineComment } from './useComments'
import { CommentBlock, CommentComposer } from './Comments'

export interface CommentAnchor {
  side: CommentSide
  line: number
}

interface DiffBlockProps {
  file: ChangedFile
  tier: Tier
  entry: DiffEntry | undefined
  requestDiff: (path: string, force?: boolean) => void
  options: FileDiffOptions<CommentAnchor>
  comments: LineComment[] | undefined
  composer: CommentAnchor | null
  onOpenComposer: (file: string, line: number, side: CommentSide, lineText: string) => void
  onSaveComposer: (text: string) => void
  onCancelComposer: () => void
  onRemoveComment: (id: string) => void
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

function lineTextAt(fileDiff: FileDiffMetadata, side: AnnotationSide, line: number): string {
  for (const hunk of fileDiff.hunks) {
    if (side === 'additions') {
      if (line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount) {
        return fileDiff.additionLines[hunk.additionLineIndex + (line - hunk.additionStart)] ?? ''
      }
    } else if (line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount) {
      return fileDiff.deletionLines[hunk.deletionLineIndex + (line - hunk.deletionStart)] ?? ''
    }
  }
  return ''
}

export default function DiffBlock({
  file,
  tier,
  entry,
  requestDiff,
  options,
  comments,
  composer,
  onOpenComposer,
  onSaveComposer,
  onCancelComposer,
  onRemoveComment,
}: DiffBlockProps) {
  const [hidden, setHidden] = useState(
    !file.binary && (tier === 'noise' || file.status === 'deleted'),
  )
  const [collapsed, setCollapsed] = useState(false)
  const [hostRef, near] = useNearViewport()

  const wantsDiff = near && !hidden && !file.binary && !collapsed
  useEffect(() => {
    if (wantsDiff) requestDiff(file.path)
  }, [wantsDiff, file.path, requestDiff])

  const gutterClickRef = useRef<(range: SelectedLineRange) => void>(() => {})
  gutterClickRef.current = (range) => {
    const side: CommentSide = range.endSide ?? range.side ?? 'additions'
    const lineText =
      entry?.status === 'ready' ? lineTextAt(entry.fileDiff, side, range.end).trimEnd() : ''
    onOpenComposer(file.path, range.end, side, lineText)
  }

  const fileOptions = useMemo<FileDiffOptions<CommentAnchor>>(
    () => ({
      ...options,
      lineHoverHighlight: 'number',
      enableGutterUtility: true,
      onGutterUtilityClick: (range) => gutterClickRef.current(range),
    }),
    [options],
  )

  const lineAnnotations = useMemo<DiffLineAnnotation<CommentAnchor>[] | undefined>(() => {
    const anchors = new Map<string, CommentAnchor>()
    for (const c of comments ?? []) {
      anchors.set(`${c.side}:${c.line}`, { side: c.side, line: c.line })
    }
    if (composer != null) anchors.set(`${composer.side}:${composer.line}`, composer)
    if (anchors.size === 0) return undefined
    return [...anchors.values()].map((a) => ({ side: a.side, lineNumber: a.line, metadata: a }))
  }, [comments, composer])

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
    body = (
      <FileDiff<CommentAnchor>
        fileDiff={entry.fileDiff}
        options={fileOptions}
        lineAnnotations={lineAnnotations}
        renderAnnotation={(annotation) => {
          const anchor = annotation.metadata
          const here = (comments ?? []).filter(
            (c) => c.line === anchor.line && c.side === anchor.side,
          )
          const composing =
            composer != null && composer.line === anchor.line && composer.side === anchor.side
          return (
            <div className="line-annotation">
              {here.map((c) => (
                <CommentBlock key={c.id} comment={c} onRemove={onRemoveComment} />
              ))}
              {composing && (
                <CommentComposer
                  placeholder="Comment on this line…"
                  onSave={onSaveComposer}
                  onCancel={onCancelComposer}
                />
              )}
            </div>
          )
        }}
      />
    )
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
