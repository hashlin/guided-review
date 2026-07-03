import type { ReactNode } from 'react'

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|\[([^\]\n]+)\]\(([^)\s]+)\)/g

function safeHref(url: string): string | undefined {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return undefined
  return url
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    if (m[1]) out.push(<code key={key++}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key++}>{m[2].slice(2, -2)}</strong>)
    else {
      const href = safeHref(m[4])
      if (href === undefined) out.push(<span key={key++}>{m[3]}</span>)
      else out.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer">
          {m[3]}
        </a>,
      )
    }
    last = index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function Markdown({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInline(p.trim())}</p>
      ))}
    </div>
  )
}
