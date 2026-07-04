import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileDiffOptions } from '@pierre/diffs'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { ReviewMeta } from '../../shared/types'
import { GR_THEME, GR_UNSAFE_CSS } from './theme'
import { buildSections, useDiffLoader, useReview } from './useReview'
import Rail, { type RailTab } from './Rail'
import SectionView from './SectionView'
import './app.css'

const EXAMPLE_CLI = '$ guided-review --base main --guide .review/guide.json'
const RAIL_MIN = 220
const RAIL_MAX = 460
const RAIL_DEFAULT = 280
const RAIL_STORAGE_KEY = 'gr-rail-width'

function clampRail(w: number): number {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, w))
}

function initialRailWidth(): number {
  try {
    const stored = parseInt(localStorage.getItem(RAIL_STORAGE_KEY) ?? '', 10)
    return clampRail(Number.isFinite(stored) ? stored : RAIL_DEFAULT)
  } catch {
    return RAIL_DEFAULT
  }
}

function RailToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <rect className="pane-fill" x="2.6" y="3.6" width="2.6" height="8.8" rx="0.8" fill="currentColor" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function cliCommand(meta: ReviewMeta): string {
  let cmd = '$ guided-review'
  if (meta.baseRef !== 'HEAD') cmd += ` --base ${meta.baseRef}`
  if (meta.headRef !== 'HEAD' && !/work/i.test(meta.headRef)) cmd += ` --head ${meta.headRef}`
  if (meta.guide != null) cmd += ' --guide …'
  return cmd
}

function LoadingScreen() {
  return (
    <div className="state-screen">
      <div style={{ width: 520, maxWidth: '100%' }}>
        <div className="skeleton" style={{ height: 18, width: 220, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 28, width: 380, marginBottom: 22 }} />
        <div className="skeleton" style={{ height: 90, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-screen">
      <div className="state-card">
        <h2>Can’t reach the review server</h2>
        <p>
          Loading <span className="mono">/api/review</span> failed ({message}). The guided-review
          CLI may have exited — relaunch it from inside your repo:
        </p>
        <code className="cli-hint">{EXAMPLE_CLI}</code>
        <button className="retry-btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  )
}

function Review({ meta }: { meta: ReviewMeta }) {
  const sections = useMemo(() => buildSections(meta), [meta])
  const hasGuide = meta.guide != null
  const reviewableCount = useMemo(
    () => sections.filter((s) => s.tier !== 'bucket').length,
    [sections],
  )

  const [current, setCurrent] = useState(0)
  const [dir, setDir] = useState(0)
  const [read, setRead] = useState<Set<string>>(new Set())
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const [railTab, setRailTab] = useState<RailTab>(hasGuide ? 'guide' : 'files')
  const [railWidth, setRailWidthState] = useState(initialRailWidth)
  const [railHidden, setRailHidden] = useState(false)
  const [dragging, setDragging] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const pendingFileRef = useRef<string | null>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const viewToggleRef = useRef<HTMLDivElement>(null)
  const viewThumbRef = useRef<HTMLSpanElement>(null)
  const prevCurrentRef = useRef(0)
  const { diffs, requestDiff } = useDiffLoader()

  const section = sections[current] as (typeof sections)[number] | undefined

  const scrollToFile = (path: string) => {
    const card = document.querySelector(`[data-path="${CSS.escape(path)}"]`)
    card?.scrollIntoView({ block: 'start' })
  }

  useEffect(() => {
    const target = pendingFileRef.current
    pendingFileRef.current = null
    if (target != null) scrollToFile(target)
    else mainRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [current])

  const goToSection = useCallback((i: number) => {
    setDir(i > prevCurrentRef.current ? 1 : i < prevCurrentRef.current ? -1 : 0)
    prevCurrentRef.current = i
    setCurrent(i)
  }, [])

  const selectSection = useCallback((i: number) => goToSection(i), [goToSection])

  const selectFile = (path: string) => {
    const idx = sections.findIndex((s) => s.files.some((f) => f.path === path))
    if (idx < 0) return
    if (idx === current) scrollToFile(path)
    else {
      pendingFileRef.current = path
      goToSection(idx)
    }
  }

  const toggleReviewed = () => {
    const s = sections[current]
    if (s == null || s.tier === 'bucket') return
    if (read.has(s.id)) {
      setRead((prev) => {
        const next = new Set(prev)
        next.delete(s.id)
        return next
      })
    } else {
      setRead((prev) => new Set(prev).add(s.id))
      if (current < sections.length - 1) goToSection(current + 1)
    }
  }

  const toggleRail = useCallback(() => setRailHidden((h) => !h), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t != null &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      )
        return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (sections.length === 0) return
      if (e.key === 'n') goToSection(Math.min(current + 1, sections.length - 1))
      else if (e.key === 'p') goToSection(Math.max(current - 1, 0))
      else if (e.key === 'ArrowDown') {
        e.preventDefault()
        goToSection(Math.min(current + 1, sections.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        goToSection(Math.max(current - 1, 0))
      } else if (e.key === 'u') setDiffStyle((s) => (s === 'unified' ? 'split' : 'unified'))
      else if (e.key === '[') toggleRail()
      else if (e.key === ' ') {
        e.preventDefault()
        toggleReviewed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      theme: GR_THEME,
      diffStyle,
      disableFileHeader: true,
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      overflow: 'scroll',
      unsafeCSS: GR_UNSAFE_CSS,
    }),
    [diffStyle],
  )

  const setRailWidth = useCallback((w: number) => {
    const clamped = clampRail(w)
    setRailWidthState(clamped)
    layoutRef.current?.style.setProperty('--rail-w', `${clamped}px`)
    return clamped
  }, [])

  const onResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = railWidth
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let latest = startW
    const onMove = (ev: MouseEvent) => {
      latest = setRailWidth(startW + ev.clientX - startX)
    }
    const onUp = () => {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, String(latest))
      } catch {
        // ignore persistence failures
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onResizerDoubleClick = () => {
    setRailWidth(RAIL_DEFAULT)
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, String(RAIL_DEFAULT))
    } catch {
      // ignore persistence failures
    }
  }

  useLayoutEffect(() => {
    const container = viewToggleRef.current
    const thumb = viewThumbRef.current
    if (container == null || thumb == null) return
    const activeBtn = container.querySelector<HTMLElement>('button.active')
    if (activeBtn == null) return
    thumb.style.left = `${activeBtn.offsetLeft}px`
    thumb.style.top = `${activeBtn.offsetTop}px`
    thumb.style.width = `${activeBtn.offsetWidth}px`
    thumb.style.height = `${activeBtn.offsetHeight}px`
  }, [diffStyle])

  useEffect(() => {
    const onResize = () => {
      const container = viewToggleRef.current
      const thumb = viewThumbRef.current
      if (container == null || thumb == null) return
      const activeBtn = container.querySelector<HTMLElement>('button.active')
      if (activeBtn == null) return
      thumb.style.left = `${activeBtn.offsetLeft}px`
      thumb.style.top = `${activeBtn.offsetTop}px`
      thumb.style.width = `${activeBtn.offsetWidth}px`
      thumb.style.height = `${activeBtn.offsetHeight}px`
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <>
      <header className="topbar">
        <button
          className={`rail-toggle${railHidden ? ' rail-off' : ''}`}
          onClick={toggleRail}
          title={`${railHidden ? 'Show sidebar' : 'Hide sidebar'} ([)`}
          aria-label="Toggle sidebar"
        >
          <RailToggleIcon />
        </button>
        <div className="wordmark">
          <span className="tilde">~/</span>guided-review
        </div>
        <div className="repo-chip">
          <b>{meta.repo}</b>
          <span>
            {meta.baseRef} → {meta.headRef}
          </span>
        </div>
        {meta.guide != null && (
          <div className="guide-chip" title={meta.guide.summary}>
            <span className="dot" />
            Guide · {meta.guide.title}
          </div>
        )}
        <div className="spacer" />
        <div className="view-toggle" role="group" aria-label="Diff view" ref={viewToggleRef}>
          <span className="seg-thumb view-thumb" ref={viewThumbRef} />
          <button
            className={diffStyle === 'unified' ? 'active' : ''}
            onClick={() => setDiffStyle('unified')}
          >
            Unified
          </button>
          <button
            className={diffStyle === 'split' ? 'active' : ''}
            onClick={() => setDiffStyle('split')}
          >
            Split
          </button>
        </div>
        <button className="finish-btn">Finish review</button>
      </header>
      <div
        className={`layout${railHidden ? ' rail-hidden' : ''}`}
        ref={layoutRef}
        style={{ '--rail-w': `${railWidth}px` } as React.CSSProperties}
      >
        <Rail
          sections={sections}
          files={meta.files}
          hasGuide={hasGuide}
          tab={railTab}
          current={current}
          read={read}
          reviewableCount={reviewableCount}
          railWidth={railWidth}
          dragging={dragging}
          onTab={setRailTab}
          onSelectSection={selectSection}
          onSelectFile={selectFile}
        />
        <div
          className={`rail-resizer${dragging ? ' dragging' : ''}`}
          onMouseDown={onResizerMouseDown}
          onDoubleClick={onResizerDoubleClick}
          title="Drag to resize · double-click to reset"
        />
        <main className="pane" ref={mainRef}>
          {section != null ? (
            <SectionView
              section={section}
              index={current}
              total={sections.length}
              isLast={current === sections.length - 1}
              reviewed={read.has(section.id)}
              dir={dir}
              onToggleReviewed={toggleReviewed}
              diffs={diffs}
              requestDiff={requestDiff}
              diffOptions={diffOptions}
            />
          ) : (
            <div className="main-inner">
              <p className="empty-note">No changes to review — the diff is empty.</p>
            </div>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span className="cli">{cliCommand(meta)}</span>
        <div className="keys">
          <span>
            <kbd>n</kbd> <kbd>p</kbd> section
          </span>
          <span>
            <kbd>space</kbd> mark reviewed
          </span>
          <span>
            <kbd>u</kbd> unified / split
          </span>
          <span>
            <kbd>[</kbd> sidebar
          </span>
        </div>
      </footer>
    </>
  )
}

function Root() {
  const { state, retry } = useReview()
  if (state.status === 'loading') return <LoadingScreen />
  if (state.status === 'error') return <ErrorScreen message={state.message} onRetry={retry} />
  return <Review meta={state.meta} />
}

export default function App() {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () =>
          new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
            type: 'module',
          }),
        poolSize: 4,
      }}
      highlighterOptions={{
        theme: GR_THEME,
        langs: ['typescript', 'tsx', 'json', 'css', 'markdown'],
      }}
    >
      <Root />
    </WorkerPoolContextProvider>
  )
}
