import type { ChangedFile } from '../../shared/types'
import type { ViewSection } from './useReview'

export type RailTab = 'guide' | 'files'

interface RailProps {
  sections: ViewSection[]
  files: ChangedFile[]
  hasGuide: boolean
  tab: RailTab
  current: number
  read: Set<string>
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
  onTab,
  onSelectSection,
  onSelectFile,
}: RailProps) {
  return (
    <nav className="rail" aria-label="Guide sections">
      <div className="rail-tabs">
        {hasGuide && (
          <button className={tab === 'guide' ? 'active' : ''} onClick={() => onTab('guide')}>
            Guide
          </button>
        )}
        <button className={tab === 'files' ? 'active' : ''} onClick={() => onTab('files')}>
          Files · {files.length}
        </button>
      </div>
      <div className="rail-list">
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
                <button key={s.id} className={cls} onClick={() => onSelectSection(i)}>
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
              <button key={f.path} className="rail-file" onClick={() => onSelectFile(f.path)}>
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
