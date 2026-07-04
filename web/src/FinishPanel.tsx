import { useEffect, useMemo, useState } from 'react'
import type { ReviewMeta } from '../../shared/types'
import type { ViewSection } from './useReview'
import type { ReviewComment } from './useComments'

function sectionTitle(sections: ViewSection[], id: string): string {
  return sections.find((s) => s.id === id)?.title ?? id
}

function buildPrompt(
  meta: ReviewMeta,
  sections: ViewSection[],
  comments: ReviewComment[],
  readCount: number,
  reviewableCount: number,
): string {
  const lines: string[] = []
  lines.push(
    `Review feedback on this change (${meta.headRef} vs ${meta.baseRef}). Please address each item:`,
  )
  lines.push('')
  comments.forEach((c, i) => {
    const title = sectionTitle(sections, c.sectionId)
    if (c.file != null && c.line != null) {
      lines.push(`${i + 1}. ${c.file}:${c.line} — ${title}`)
      if (c.lineText != null && c.lineText.trim().length > 0) {
        lines.push(`   > ${c.lineText.trim()}`)
      }
    } else {
      lines.push(`${i + 1}. ${title} (section note)`)
    }
    lines.push(`   ${c.text}`)
    lines.push('')
  })
  lines.push(`Reviewed ${readCount} of ${reviewableCount} guide sections at time of export.`)
  return lines.join('\n')
}

interface FinishPanelProps {
  meta: ReviewMeta
  sections: ViewSection[]
  comments: ReviewComment[]
  readCount: number
  reviewableCount: number
  onClose: () => void
  onRemove: (id: string) => void
}

export default function FinishPanel({
  meta,
  sections,
  comments,
  readCount,
  reviewableCount,
  onClose,
  onRemove,
}: FinishPanelProps) {
  const [copied, setCopied] = useState(false)
  const prompt = useMemo(
    () => buildPrompt(meta, sections, comments, readCount, reviewableCount),
    [meta, sections, comments, readCount, reviewableCount],
  )

  useEffect(() => {
    setCopied(false)
  }, [prompt])

  const copy = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(prompt)
      ok = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      ta.remove()
    }
    setCopied(ok)
  }

  const n = comments.length
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="finish-panel" role="dialog" aria-modal="true" aria-label="Finish review">
        <div className="fp-head">
          <h2>Finish review</h2>
          <span className="fp-meta">
            {readCount} / {reviewableCount} sections reviewed · {n} comment{n === 1 ? '' : 's'}
          </span>
          <button className="fp-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="fp-body">
          {n === 0 ? (
            <div className="fp-empty">
              No comments. Add comments on lines you want changed — they collect here.
            </div>
          ) : (
            <>
              {comments.map((c) => {
                const title = sectionTitle(sections, c.sectionId)
                return (
                  <div key={c.id} className="fp-item">
                    <div className="fp-ref">
                      {c.file != null && c.line != null ? (
                        <span className="fp-path">
                          {c.file}:{c.line}
                        </span>
                      ) : (
                        <span className="fp-path">section note</span>
                      )}
                      <span>{title}</span>
                      <button className="fp-remove" onClick={() => onRemove(c.id)}>
                        Remove
                      </button>
                    </div>
                    {c.lineText != null && c.lineText.trim().length > 0 && (
                      <pre className="fp-quote">{c.lineText.trim()}</pre>
                    )}
                    <div className="fp-text">{c.text}</div>
                  </div>
                )
              })}
              <details className="prompt-preview">
                <summary>Preview prompt</summary>
                <pre>{prompt}</pre>
              </details>
            </>
          )}
        </div>
        <div className="fp-foot">
          <button className="btn-quiet" onClick={onClose}>
            Keep reviewing
          </button>
          <span className="spacer" />
          <button
            className={`copy-prompt-btn${copied ? ' copied' : ''}`}
            onClick={copy}
            disabled={n === 0}
          >
            {copied ? 'Copied — paste to agent' : 'Copy as prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}
