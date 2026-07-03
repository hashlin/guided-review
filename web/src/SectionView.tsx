import type { FileDiffOptions } from '@pierre/diffs'
import type { DiffEntry, ViewSection } from './useReview'
import DiffBlock from './DiffBlock'
import Markdown from './Markdown'

const TIER_LABEL: Record<string, string> = {
  core: 'Core',
  supporting: 'Supporting',
  noise: 'Noise',
  bucket: 'Unguided',
}

interface SectionViewProps {
  section: ViewSection
  index: number
  total: number
  isLast: boolean
  reviewed: boolean
  onToggleReviewed: () => void
  diffs: Map<string, DiffEntry>
  requestDiff: (path: string, force?: boolean) => void
  diffOptions: FileDiffOptions<undefined>
}

export default function SectionView({
  section,
  index,
  total,
  isLast,
  reviewed,
  onToggleReviewed,
  diffs,
  requestDiff,
  diffOptions,
}: SectionViewProps) {
  return (
    <div className="main-inner">
      <div className="section-eyebrow">
        <span>
          Section {index + 1} of {total}
        </span>
        <span className={`tier-pill ${section.tier}`}>{TIER_LABEL[section.tier]}</span>
      </div>
      <h1 className="section-title">{section.title}</h1>
      {section.note != null && <p className="bucket-note">{section.note}</p>}
      {section.explanation.trim().length > 0 && (
        <Markdown className="explanation" text={section.explanation} />
      )}
      {section.insights.map((insight, i) => (
        <div key={i} className={`insight ${insight.kind}`}>
          <span className="insight-kind">{insight.kind}</span>
          <span>{insight.text}</span>
        </div>
      ))}
      {section.files.map((file) => (
        <DiffBlock
          key={`${section.id}:${file.path}`}
          file={file}
          tier={section.tier}
          entry={diffs.get(file.path)}
          requestDiff={requestDiff}
          options={diffOptions}
        />
      ))}
      {section.tier !== 'bucket' && (
        <div className="section-actions">
          <button className={`mark-read-btn${reviewed ? ' done' : ''}`} onClick={onToggleReviewed}>
            {reviewed ? '✓ Reviewed' : 'Mark section reviewed'}
          </button>
          {!isLast && (
            <span className="next-hint">
              then <kbd>n</kbd> for next section
            </span>
          )}
        </div>
      )}
    </div>
  )
}
