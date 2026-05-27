"use client";

import { useEffect, useState } from "react";

export default function ReadAloudButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function handleClick() {
    if (!("speechSynthesis" in window)) {
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.95;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 rounded-full border border-[#d5d0c8] bg-white px-3 py-1.5 text-xs font-medium text-[#1a3a2a] transition hover:border-[#b9d2bd] hover:bg-[#f8f5ef]"
      aria-pressed={isSpeaking}
      aria-label={isSpeaking ? `Stop reading ${label}` : `Read ${label} aloud`}
    >
      <span className="text-[#2d6a4a]">{isSpeaking ? "Stop" : "Read aloud"}</span>
    </button>
  );
}
