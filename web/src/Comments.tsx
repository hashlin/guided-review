import { useEffect, useRef, useState } from 'react'
import type { ReviewComment } from './useComments'

export function CommentBlock({
  comment,
  onRemove,
}: {
  comment: ReviewComment
  onRemove: (id: string) => void
}) {
  return (
    <div className="comment-block">
      <div className="comment-label">
        <span>Your comment</span>
        <button className="remove-comment" onClick={() => onRemove(comment.id)}>
          Remove
        </button>
      </div>
      <div className="comment-text">{comment.text}</div>
    </div>
  )
}

export function CommentComposer({
  placeholder,
  onSave,
  onCancel,
}: {
  placeholder: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const save = () => {
    const trimmed = text.trim()
    if (trimmed.length > 0) onSave(trimmed)
  }

  return (
    <div className="comment-composer">
      <textarea
        ref={taRef}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save()
          else if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="composer-actions">
        <button className="btn-sm-primary" onClick={save}>
          Comment
        </button>
        <button className="btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
