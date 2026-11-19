"use client";

export default function CircularDownloadProgress({
  pct,
  indeterminate,
  onCancel,
  chapterLabel,
}: {
  pct: number;
  indeterminate: boolean;
  onCancel: () => void;
  chapterLabel: string;
}) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = indeterminate ? circ * 0.72 : circ * (1 - clamped / 100);

  return (
    <div className="chap-dl-progress">
      <span className="chap-dl-pct" aria-live="polite">
        {indeterminate ? "…" : `${clamped}%`}
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="chap-dl-ring-btn"
        title={`Downloading ${clamped}% — click to cancel`}
        aria-label={`Downloading Chapter ${chapterLabel} (${clamped}%). Click to cancel`}
      >
        <svg viewBox="0 0 36 36" className={indeterminate ? "chap-dl-ring spin" : "chap-dl-ring"} aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            transform="rotate(-90 18 18)"
            style={{ transition: "stroke-dashoffset 160ms ease" }}
          />
          <path
            d="M18 11.5v10.5m0 0-3.8-3.8m3.8 3.8 3.8-3.8"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
