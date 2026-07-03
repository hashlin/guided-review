import { useCallback, useEffect, useRef, useState } from 'react'
import { processFile, type FileDiffMetadata } from '@pierre/diffs'
import type { ChangedFile, GuideInsight, ReviewMeta, Signal } from '../../shared/types'

export type Tier = Signal | 'bucket'

export interface ViewSection {
  id: string
  title: string
  tier: Tier
  explanation: string
  insights: GuideInsight[]
  files: ChangedFile[]
  additions: number
  deletions: number
  note?: string
}

export const BUCKET_NOTE =
  'Changed in the diff but not referenced by any guide section. The diff is always ground truth — a partial or stale guide can never hide code from review.'

export function buildSections(meta: ReviewMeta): ViewSection[] {
  const byPath = new Map(meta.files.map((f) => [f.path, f]))
  const referenced = new Set<string>()
  const sections: ViewSection[] = []

  if (meta.guide) {
    meta.guide.sections.forEach((s, i) => {
      const files: ChangedFile[] = []
      const seen = new Set<string>()
      for (const ref of s.refs) {
        if (seen.has(ref.file)) continue
        seen.add(ref.file)
        referenced.add(ref.file)
        const file = byPath.get(ref.file)
        if (file) files.push(file)
      }
      sections.push({
        id: s.id ?? `section-${i}`,
        title: s.title,
        tier: s.signal,
        explanation: s.explanation,
        insights: s.insights ?? [],
        files,
        additions: files.reduce((a, f) => a + f.additions, 0),
        deletions: files.reduce((a, f) => a + f.deletions, 0),
      })
    })
    const rest = meta.files.filter((f) => !referenced.has(f.path))
    if (rest.length > 0) {
      sections.push({
        id: '__bucket__',
        title: 'Everything else',
        tier: 'bucket',
        explanation: '',
        insights: [],
        files: rest,
        additions: rest.reduce((a, f) => a + f.additions, 0),
        deletions: rest.reduce((a, f) => a + f.deletions, 0),
        note: BUCKET_NOTE,
      })
    }
  } else if (meta.files.length > 0) {
    sections.push({
      id: '__all__',
      title: 'All changes',
      tier: 'bucket',
      explanation: '',
      insights: [],
      files: meta.files,
      additions: meta.files.reduce((a, f) => a + f.additions, 0),
      deletions: meta.files.reduce((a, f) => a + f.deletions, 0),
      note: 'No guide was provided for this review — showing the full diff, file by file.',
    })
  }
  return sections
}

export type ReviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; meta: ReviewMeta }

export function useReview(): { state: ReviewState; retry: () => void } {
  const [state, setState] = useState<ReviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch('/api/review')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<ReviewMeta>
      })
      .then((meta) => {
        if (!cancelled) setState({ status: 'ready', meta })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { state, retry }
}

export type DiffEntry =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; fileDiff: FileDiffMetadata }

const MAX_IN_FLIGHT = 4

export function useDiffLoader(): {
  diffs: Map<string, DiffEntry>
  requestDiff: (path: string, force?: boolean) => void
} {
  const [diffs, setDiffs] = useState<Map<string, DiffEntry>>(new Map())
  const requestedRef = useRef(new Set<string>())
  const queueRef = useRef<string[]>([])
  const inFlightRef = useRef(0)

  const pump = useCallback(() => {
    while (inFlightRef.current < MAX_IN_FLIGHT && queueRef.current.length > 0) {
      const path = queueRef.current.shift()!
      inFlightRef.current++
      fetch(`/api/diff?file=${encodeURIComponent(path)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.text()
        })
        .then((text) => {
          const fileDiff = text.trim()
            ? processFile(text, { isGitDiff: true, cacheKey: path })
            : undefined
          setDiffs((prev) =>
            new Map(prev).set(
              path,
              fileDiff ? { status: 'ready', fileDiff } : { status: 'empty' },
            ),
          )
        })
        .catch((err: unknown) => {
          setDiffs((prev) => new Map(prev).set(path, { status: 'error', message: String(err) }))
        })
        .finally(() => {
          inFlightRef.current--
          pump()
        })
    }
  }, [])

  const requestDiff = useCallback(
    (path: string, force = false) => {
      if (requestedRef.current.has(path) && !force) return
      requestedRef.current.add(path)
      queueRef.current.push(path)
      setDiffs((prev) => new Map(prev).set(path, { status: 'loading' }))
      pump()
    },
    [pump],
  )

  return { diffs, requestDiff }
}
