"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export default function SynopsisExpand({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = (text || "").trim();
  const isLong = trimmed.length > 190;

  return (
    <div className="synop-wrap">
      <p className={`synop ${!expanded && isLong ? "line-clamp-3" : ""}`} style={{ marginBottom: isLong ? 6 : 16 }}>
        {trimmed}
      </p>
      {isLong && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="synop-toggle"
          >
            <span>{expanded ? "Show less" : "Show more"}</span>
            {expanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}
