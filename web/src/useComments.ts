import { useCallback, useEffect, useState } from 'react'
import type { ReviewMeta } from '../../shared/types'

export type CommentSide = 'additions' | 'deletions'

export interface LineComment {
  id: string
  sectionId: string
  file: string
  line: number
  side: CommentSide
  lineText: string
  text: string
}

export interface SectionNote {
  id: string
  sectionId: string
  file: null
  line: null
  lineText: null
  text: string
}

export type ReviewComment = LineComment | SectionNote

function diffFingerprint(meta: ReviewMeta): string {
  const src = meta.files
    .map((f) => `${f.path}\0${f.status}\0${f.additions}\0${f.deletions}`)
    .join('\n')
  let hash = 5381
  for (let i = 0; i < src.length; i++) hash = ((hash * 33) ^ src.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

function commentsKey(meta: ReviewMeta): string {
  return `gr-comments:${meta.repo}:${meta.baseRef}:${meta.headRef}:${diffFingerprint(meta)}`
}

function loadComments(key: string): ReviewComment[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ReviewComment[]) : []
  } catch {
    return []
  }
}

function newCommentId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

export type NewComment = Omit<LineComment, 'id'> | Omit<SectionNote, 'id'>

export function useComments(meta: ReviewMeta): {
  comments: ReviewComment[]
  addComment: (comment: NewComment) => void
  removeComment: (id: string) => void
} {
  const key = commentsKey(meta)
  const [comments, setComments] = useState<ReviewComment[]>(() => loadComments(key))

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(comments))
    } catch {
      // ignore persistence failures
    }
  }, [key, comments])

  const addComment = useCallback((comment: NewComment) => {
    setComments((prev) => [...prev, { ...comment, id: newCommentId() }])
  }, [])

  const removeComment = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return { comments, addComment, removeComment }
}
