import type { FileDiffOptions } from '@pierre/diffs'
import type { DiffEntry, ViewSection } from './useReview'
import type { CommentSide, LineComment, ReviewComment } from './useComments'
import DiffBlock, { type CommentAnchor } from './DiffBlock'
import { CommentBlock, CommentComposer } from './Comments'
import Markdown from './Markdown'

const TIER_LABEL: Record<string, string> = {
  core: 'Core',
  supporting: 'Supporting',
  noise: 'Noise',
  bucket: 'Unguided',
}

export type ComposerState =
  | { kind: 'line'; file: string; line: number; side: CommentSide; lineText: string }
  | { kind: 'note' }

interface SectionViewProps {
  section: ViewSection
  index: number
  total: number
  reviewed: boolean
  dir: number
  onToggleReviewed: () => void
  diffs: Map<string, DiffEntry>
  requestDiff: (path: string, force?: boolean) => void
  diffOptions: FileDiffOptions<CommentAnchor>
  lineComments: Map<string, LineComment[]>
  notes: ReviewComment[]
  composer: ComposerState | null
  onOpenLineComposer: (file: string, line: number, side: CommentSide, lineText: string) => void
  onOpenNoteComposer: () => void
  onSaveComposer: (text: string) => void
  onCancelComposer: () => void
  onRemoveComment: (id: string) => void
}

export default function SectionView({
  section,
  index,
  total,
  reviewed,
  dir,
  onToggleReviewed,
  diffs,
  requestDiff,
  diffOptions,
  lineComments,
  notes,
  composer,
  onOpenLineComposer,
  onOpenNoteComposer,
  onSaveComposer,
  onCancelComposer,
  onRemoveComment,
}: SectionViewProps) {
  const rollClass = dir > 0 ? ' roll-next' : dir < 0 ? ' roll-prev' : ''
  return (
    <div className="main-inner">
      <div className="section-eyebrow">
        <span>
          Section{' '}
          <span className="sec-num-clip">
            <span key={index} className={`sec-num${rollClass}`}>
              {index + 1}
            </span>
          </span>{' '}
          of {total}
        </span>
        <span className={`tier-pill ${section.tier}`}>{TIER_LABEL[section.tier]}</span>
        {reviewed && <span className="reviewed-flag">✓ Reviewed</span>}
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
          comments={lineComments.get(file.path)}
          composer={
            composer != null && composer.kind === 'line' && composer.file === file.path
              ? composer
              : null
          }
          onOpenComposer={onOpenLineComposer}
          onSaveComposer={onSaveComposer}
          onCancelComposer={onCancelComposer}
          onRemoveComment={onRemoveComment}
        />
      ))}
      {section.tier !== 'bucket' && (
        <>
          {notes.map((note) => (
            <div key={note.id} className="section-note">
              <CommentBlock comment={note} onRemove={onRemoveComment} />
            </div>
          ))}
          {composer?.kind === 'note' && (
            <div className="note-composer">
              <CommentComposer
                placeholder="Note on this section…"
                onSave={onSaveComposer}
                onCancel={onCancelComposer}
              />
            </div>
          )}
          <div className="section-actions">
            <button className="add-note-btn" onClick={onOpenNoteComposer}>
              Add section note
            </button>
            <button className={`mark-read-btn${reviewed ? ' done' : ''}`} onClick={onToggleReviewed}>
              {reviewed ? '✓ Reviewed' : 'Mark section reviewed'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
