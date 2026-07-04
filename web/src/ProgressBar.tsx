export default function ProgressBar({ done, total }: { done: number; total: number }) {
  const C = 34.56
  const offset = total > 0 ? C * (1 - done / total) : C
  return (
    <div className="rail-progress" title={`${done} of ${total} sections reviewed`}>
      <svg className="progress-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle className="ring-track" cx="7" cy="7" r="5.5" />
        <circle
          className="ring-fill"
          cx="7"
          cy="7"
          r="5.5"
          transform="rotate(-90 7 7)"
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <span>
        {done}/{total}
      </span>
    </div>
  )
}
