import {
  processPatch,
  registerCustomCSSVariableTheme,
  type CodeViewDiffItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
} from '@pierre/diffs'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { generatePatchSet, type SpikeSection } from './generatePatchSet'
import './spike.css'

// ---------------------------------------------------------------------------
// Q2 THEMING: register a shiki "CSS variables" theme. Every token color
// becomes `var(--diffs-token-*, fallback)` and fg/bg become
// `var(--diffs-foreground)` / `var(--diffs-background)`. Those custom
// properties inherit through the shadow DOM boundary, so light/dark is driven
// entirely by our own CSS in spike.css (see :root / :root[data-theme='dark']).
// ---------------------------------------------------------------------------
registerCustomCSSVariableTheme('spike-vars', {
  foreground: '#1f2328',
  background: '#ffffff',
  'token-keyword': '#cf222e',
  'token-string': '#0a3069',
  'token-comment': '#6e7781',
  'token-constant': '#0550ae',
  'token-function': '#8250df',
  'token-parameter': '#953800',
  'token-punctuation': '#57606a',
  'token-string-expression': '#116329',
  'token-link': '#0a3069',
})

// Component chrome (headers, diff line backgrounds, fonts) is overridable via
// `unsafeCSS`, injected into each shadow root in the highest cascade layer.
const SPIKE_UNSAFE_CSS = `
:host {
  --diffs-addition-base: var(--spike-addition, #1a7f37);
  --diffs-deletion-base: var(--spike-deletion, #cf222e);
  --diffs-header-font-family: var(--spike-ui-font, system-ui);
}
`

type SectionProse = Pick<SpikeSection, 'index' | 'title' | 'paragraphs'> & { fileCount: number }

type SpikeMetrics = Record<string, unknown>

declare global {
  interface Window {
    __SPIKE_METRICS__?: SpikeMetrics
    __SPIKE_DONE__?: boolean
  }
}

const metrics: SpikeMetrics = {}
if (typeof window !== 'undefined') window.__SPIKE_METRICS__ = metrics

function updateMetricsPanel() {
  const el = document.getElementById('spike-metrics')
  if (el) el.textContent = JSON.stringify(metrics, null, 2)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) resolve()
      else requestAnimationFrame(() => step(remaining - 1))
    }
    step(count)
  })
}

function diffsHosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll('diffs-container')) as HTMLElement[]
}

function countDomNodes(): number {
  let count = document.querySelectorAll('*').length
  for (const host of diffsHosts()) count += host.shadowRoot?.querySelectorAll('*').length ?? 0
  return count
}

function sampleThemeColors() {
  for (const host of diffsHosts()) {
    const pre = host.shadowRoot?.querySelector('pre')
    if (pre == null) continue
    const token = pre.querySelector('span[style*="color"]')
    return {
      preBackground: getComputedStyle(pre).backgroundColor,
      preColor: getComputedStyle(pre).color,
      tokenColor: token ? getComputedStyle(token).color : undefined,
    }
  }
  return undefined
}

function hasSplitColumns(): boolean {
  return diffsHosts().some(
    (host) =>
      host.shadowRoot?.querySelector('[data-deletions]') != null &&
      host.shadowRoot?.querySelector('[data-additions]') != null,
  )
}

function hasUnifiedColumn(): boolean {
  return diffsHosts().some((host) => host.shadowRoot?.querySelector('[data-unified]') != null)
}

function pollFirstPaintedDiff(t0: number) {
  const check = () => {
    for (const host of diffsHosts()) {
      const pre = host.shadowRoot?.querySelector('pre')
      if (pre != null && (pre.textContent?.trim().length ?? 0) > 0) {
        metrics.mountToFirstPaintedDiffMs = Math.round(performance.now() - t0)
        updateMetricsPanel()
        return
      }
    }
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

interface ScrollStats {
  frames: number
  meanFrameMs: number
  maxFrameMs: number
  framesOver20ms: number
  framesOver34ms: number
  scrolledPx: number
}

function runScrollTest(
  handle: CodeViewHandle<SectionProse>,
  durationMs: number,
): Promise<ScrollStats | undefined> {
  const instance = handle.getInstance()
  if (instance == null) return Promise.resolve(undefined)
  const total = instance.getScrollHeight() - instance.getHeight()
  const gaps: number[] = []
  return new Promise((resolve) => {
    let last: number | undefined
    const start = performance.now()
    const frame = (now: number) => {
      if (last != null) gaps.push(now - last)
      last = now
      const progress = Math.min(1, (now - start) / durationMs)
      instance.scrollTo({ type: 'position', position: progress * total, behavior: 'instant' })
      if (progress < 1) requestAnimationFrame(frame)
      else {
        const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length)
        resolve({
          frames: gaps.length,
          meanFrameMs: Math.round(mean * 100) / 100,
          maxFrameMs: Math.round(Math.max(...gaps) * 100) / 100,
          framesOver20ms: gaps.filter((g) => g > 20).length,
          framesOver34ms: gaps.filter((g) => g > 34).length,
          scrolledPx: Math.round(total),
        })
      }
    }
    requestAnimationFrame(frame)
  })
}

const patchSet = generatePatchSet(300)
metrics.fileCount = patchSet.files.length
metrics.totalChangedLines = patchSet.totalChangedLines
metrics.sectionCount = patchSet.sections.length

const sectionByFirstFile = new Map<number, SectionProse>()
for (const section of patchSet.sections) {
  sectionByFirstFile.set(section.fileIndexes[0], {
    index: section.index,
    title: section.title,
    paragraphs: section.paragraphs,
    fileCount: section.fileIndexes.length,
  })
}

// ---------------------------------------------------------------------------
// Q4 lazy loading: each file's raw diff text is "fetched" with a simulated
// 10ms network delay (concurrency 8), parsed with processPatch, and published
// to the controlled `items` array as an append-only contiguous prefix so
// CodeView takes its append fast path.
// ---------------------------------------------------------------------------
function useLazyLoadedItems(): CodeViewDiffItem<SectionProse>[] {
  const [items, setItems] = useState<CodeViewDiffItem<SectionProse>[]>([])

  useEffect(() => {
    let cancelled = false
    const loadStart = performance.now()
    const parsed: (CodeViewDiffItem<SectionProse> | undefined)[] = new Array(patchSet.files.length)
    let publishedUpTo = 0
    let publishQueued = false

    const publish = () => {
      publishQueued = false
      if (cancelled) return
      let end = publishedUpTo
      while (end < parsed.length && parsed[end] != null) end++
      if (end === publishedUpTo) return
      const chunk = parsed.slice(publishedUpTo, end) as CodeViewDiffItem<SectionProse>[]
      publishedUpTo = end
      setItems((prev) => prev.concat(chunk))
      if (publishedUpTo === parsed.length) {
        metrics.allFilesLoadedAndPublishedMs = Math.round(performance.now() - loadStart)
        updateMetricsPanel()
      }
    }

    const schedulePublish = () => {
      if (publishQueued) return
      publishQueued = true
      requestAnimationFrame(publish)
    }

    let cursor = 0
    const worker = async () => {
      while (!cancelled) {
        const i = cursor++
        if (i >= patchSet.files.length) return
        await sleep(10) // simulated per-file fetch
        if (cancelled) return
        const file = patchSet.files[i]
        const fileDiff = processPatch(file.diffText, `spike-${i}`).files[0]
        if (fileDiff == null) continue
        const prose = sectionByFirstFile.get(i)
        const annotations: DiffLineAnnotation<SectionProse>[] | undefined =
          prose != null ? [{ side: 'additions', lineNumber: 0, metadata: prose }] : undefined
        parsed[i] = { id: file.path, type: 'diff', fileDiff, annotations }
        schedulePublish()
      }
    }
    for (let c = 0; c < 8; c++) void worker()

    return () => {
      cancelled = true
    }
  }, [])

  return items
}

function SectionProseBlock({ prose }: { prose: SectionProse }) {
  return (
    <section className="spike-prose">
      <div className="spike-prose-kicker">
        Section {prose.index + 1} of {patchSet.sections.length} · {prose.fileCount} files
      </div>
      <h2>{prose.title}</h2>
      {prose.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </section>
  )
}

async function runAutoSequence(
  getHandle: () => CodeViewHandle<SectionProse> | null,
  setDiffStyle: (style: 'unified' | 'split') => void,
) {
  await sleep(800)
  metrics.domNodesAtRest = countDomNodes()
  metrics.unifiedColumnFound = hasUnifiedColumn()
  updateMetricsPanel()

  const handle = getHandle()
  if (handle != null) {
    const instance = handle.getInstance()
    metrics.logicalScrollHeightPx = instance != null ? Math.round(instance.getScrollHeight()) : undefined
    metrics.scrollFullListIn6s = await runScrollTest(handle, 6000)
    await sleep(400)
    metrics.domNodesAfterScroll = countDomNodes()
    updateMetricsPanel()
  }

  const splitStart = performance.now()
  setDiffStyle('split')
  await nextFrames(10)
  await sleep(600)
  metrics.splitToggle = {
    settledAfterMs: Math.round(performance.now() - splitStart),
    splitColumnsFound: hasSplitColumns(),
  }
  metrics.scrollWhileSplitIn3s = getHandle() != null ? await runScrollTest(getHandle()!, 3000) : undefined
  setDiffStyle('unified')
  await nextFrames(10)
  await sleep(400)
  metrics.backToUnifiedFound = hasUnifiedColumn()
  updateMetricsPanel()

  const light = sampleThemeColors()
  document.documentElement.dataset.theme = 'dark'
  await nextFrames(4)
  const dark = sampleThemeColors()
  document.documentElement.dataset.theme = 'light'
  metrics.themeColorsLight = light
  metrics.themeColorsDark = dark
  metrics.cssVarThemingWorks =
    light != null && dark != null && light.preBackground !== dark.preBackground

  metrics.finishedAtMs = Math.round(performance.now())
  updateMetricsPanel()
  window.__SPIKE_DONE__ = true
}

function SpikeReview() {
  const items = useLazyLoadedItems()
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified')
  const handleRef = useRef<CodeViewHandle<SectionProse>>(null)
  const mountTimeRef = useRef<number | undefined>(undefined)
  const autoRanRef = useRef(false)

  useLayoutEffect(() => {
    if (mountTimeRef.current == null) {
      mountTimeRef.current = performance.now()
      pollFirstPaintedDiff(mountTimeRef.current)
    }
  }, [])

  useEffect(() => {
    // debug hook for the headless measurement harness
    ;(window as unknown as Record<string, unknown>).__SPIKE_SCROLL_TO = (position: number) =>
      handleRef.current?.scrollTo({ type: 'position', position, behavior: 'instant' })
  }, [])

  const allLoaded = items.length === patchSet.files.length
  useEffect(() => {
    if (!allLoaded || autoRanRef.current) return
    if (!new URLSearchParams(location.search).has('auto')) return
    autoRanRef.current = true
    void runAutoSequence(() => handleRef.current, setDiffStyle)
  }, [allLoaded])

  const options = useMemo<CodeViewOptions<SectionProse>>(
    () => ({
      theme: 'spike-vars',
      diffStyle,
      stickyHeaders: true,
      hunkSeparators: 'line-info',
      lineDiffType: 'word-alt',
      unsafeCSS: SPIKE_UNSAFE_CSS,
      overflow: 'scroll',
    }),
    [diffStyle],
  )

  return (
    <div className="spike-shell">
      <header className="spike-header">
        <strong>guided-review spike</strong>
        <span>
          {items.length}/{patchSet.files.length} files · {patchSet.totalChangedLines} changed lines
        </span>
        <button
          onClick={() => setDiffStyle((s) => (s === 'unified' ? 'split' : 'unified'))}
        >
          style: {diffStyle}
        </button>
        <button
          onClick={() => {
            const root = document.documentElement
            root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
          }}
        >
          toggle theme
        </button>
        <button
          onClick={() => {
            if (handleRef.current == null) return
            void runScrollTest(handleRef.current, 6000).then((stats) => {
              metrics.manualScrollTest = stats
              updateMetricsPanel()
            })
          }}
        >
          scroll test
        </button>
      </header>
      <div className="spike-codeview-host">
        <CodeView<SectionProse>
          ref={handleRef}
          items={items}
          options={options}
          renderAnnotation={(annotation) =>
            annotation.metadata != null ? <SectionProseBlock prose={annotation.metadata} /> : null
          }
        />
      </div>
      <pre id="spike-metrics" className="spike-metrics" />
    </div>
  )
}

export default function SpikeApp() {
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
        theme: 'spike-vars',
        langs: ['typescript', 'tsx', 'css'],
      }}
    >
      <SpikeReview />
    </WorkerPoolContextProvider>
  )
}
