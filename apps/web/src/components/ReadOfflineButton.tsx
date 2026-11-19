"use client";

import { Download } from "lucide-react";

export default function ReadOfflineButton() {
  const handleClick = () => {
    const el = document.getElementById("chapters-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cv:open-bulk-offline"));
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="cv-detail-btn cv-offline-btn"
    >
      <Download size={16} aria-hidden />
      <span>Read Offline</span>
    </button>
  );
}
