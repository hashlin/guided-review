import { useLayoutEffect, useRef } from 'react'
import type { ChangedFile } from '../../shared/types'
import type { ViewSection } from './useReview'
import ProgressBar from './ProgressBar'

export type RailTab = 'guide' | 'files'

interface RailProps {
  sections: ViewSection[]
  files: ChangedFile[]
  hasGuide: boolean
  tab: RailTab
  current: number
  read: Set<string>
  reviewableCount: number
  railWidth: number
  dragging: boolean
  onTab: (tab: RailTab) => void
  onSelectSection: (index: number) => void
  onSelectFile: (path: string) => void
}

function SplitPath({ path }: { path: string }) {
  const parts = path.split('/')
  const name = parts.pop()!
  return (
    <>
      {parts.length > 0 && <span className="dir">{parts.join('/')}/</span>}
      {name}
    </>
  )
}

export default function Rail({
  sections,
  files,
  hasGuide,
  tab,
  current,
  read,
  reviewableCount,
  railWidth,
  dragging,
  onTab,
  onSelectSection,
  onSelectFile,
}: RailProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabThumbRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (list == null || indicator == null) return
    if (tab !== 'guide') {
      indicator.style.opacity = '0'
      return
    }
    const active = list.querySelector<HTMLElement>('.rail-item.active')
    if (active == null) {
      indicator.style.opacity = '0'
      return
    }
    indicator.style.opacity = '1'
    indicator.style.top = `${active.offsetTop}px`
    indicator.style.height = `${active.offsetHeight}px`
    active.scrollIntoView({ block: 'nearest' })
  }, [current, tab, railWidth])

  useLayoutEffect(() => {
    const onResize = () => {
      const list = listRef.current
      const indicator = indicatorRef.current
      if (list != null && indicator != null && tab === 'guide') {
        const active = list.querySelector<HTMLElement>('.rail-item.active')
        if (active != null) {
          indicator.style.top = `${active.offsetTop}px`
          indicator.style.height = `${active.offsetHeight}px`
        }
      }
      const tabs = tabsRef.current
      const thumb = tabThumbRef.current
      if (tabs != null && thumb != null) {
        const activeBtn = tabs.querySelector<HTMLElement>('button.active')
        if (activeBtn != null) {
          thumb.style.left = `${activeBtn.offsetLeft}px`
          thumb.style.top = `${activeBtn.offsetTop}px`
          thumb.style.width = `${activeBtn.offsetWidth}px`
          thumb.style.height = `${activeBtn.offsetHeight}px`
        }
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [tab])

  useLayoutEffect(() => {
    const tabs = tabsRef.current
    const thumb = tabThumbRef.current
    if (tabs == null || thumb == null) return
    const activeBtn = tabs.querySelector<HTMLElement>('button.active')
    if (activeBtn == null) return
    thumb.style.left = `${activeBtn.offsetLeft}px`
    thumb.style.top = `${activeBtn.offsetTop}px`
    thumb.style.width = `${activeBtn.offsetWidth}px`
    thumb.style.height = `${activeBtn.offsetHeight}px`
  }, [tab, hasGuide])

  return (
    <nav className="rail" aria-label="Guide sections">
      <div className="rail-tabs" ref={tabsRef}>
        <span className="seg-thumb tab-thumb" ref={tabThumbRef} />
        {hasGuide && (
          <button
            className={tab === 'guide' ? 'active' : ''}
            onClick={(e) => {
              e.currentTarget.blur()
              onTab('guide')
            }}
          >
            Guide
          </button>
        )}
        <button
          className={tab === 'files' ? 'active' : ''}
          onClick={(e) => {
            e.currentTarget.blur()
            onTab('files')
          }}
        >
          Files · {files.length}
        </button>
        {hasGuide && <ProgressBar done={read.size} total={reviewableCount} />}
      </div>
      <div className="rail-list" ref={listRef}>
        {tab === 'guide' && (
          <div className={`rail-indicator${dragging ? ' no-anim' : ''}`} ref={indicatorRef} />
        )}
        {tab === 'guide'
          ? sections.map((s, i) => {
              const cls = [
                'rail-item',
                `tier-${s.tier}`,
                i === current ? 'active' : '',
                read.has(s.id) ? 'read' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={s.id}
                  className={cls}
                  onClick={(e) => {
                    e.currentTarget.blur()
                    onSelectSection(i)
                  }}
                >
                  <span className="tier-mark" />
                  <span className="rail-item-body">
                    <div className="rail-item-title">{s.title}</div>
                    <div className="rail-item-meta">
                      {s.files.length === 0 ? (
                        'prose only'
                      ) : (
                        <>
                          {s.files.length} file{s.files.length === 1 ? '' : 's'} ·{' '}
                          <span className="stat-add">+{s.additions.toLocaleString()}</span>{' '}
                          <span className="stat-del">−{s.deletions.toLocaleString()}</span>
                        </>
                      )}
                    </div>
                  </span>
                  <span className="read-mark">✓</span>
                </button>
              )
            })
          : files.map((f) => (
              <button
                key={f.path}
                className="rail-file"
                onClick={(e) => {
                  e.currentTarget.blur()
                  onSelectFile(f.path)
                }}
              >
                <span className="file-label">
                  <SplitPath path={f.path} />
                </span>
                <span className="stats">
                  {f.binary ? (
                    'BIN'
                  ) : (
                    <>
                      <span className="stat-add">+{f.additions.toLocaleString()}</span>{' '}
                      <span className="stat-del">−{f.deletions.toLocaleString()}</span>
                    </>
                  )}
                </span>
              </button>
            ))}
      </div>
      {hasGuide && (
        <div className="rail-footer">
          <div className="legend">
            <span>
              <span className="tier-mark mark-core" />
              core
            </span>
            <span>
              <span className="tier-mark mark-supporting" />
              supporting
            </span>
            <span>
              <span className="tier-mark mark-noise" />
              noise
            </span>
          </div>
        </div>
      )}
    </nav>
  )
}
