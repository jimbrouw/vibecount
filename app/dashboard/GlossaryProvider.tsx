"use client";

import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { trackEvent } from "@/lib/analytics";

export type GlossaryTerm = {
  id: string;
  term: string;
  explanation: string;
  example: string;
};

type GlossaryContextValue = {
  terms: GlossaryTerm[];
  open: (termId: string) => void;
  openByName: (name: string) => void;
};

const GlossaryContext = createContext<GlossaryContextValue>({
  terms: [],
  open: () => {},
  openByName: () => {},
});

export function useGlossary() {
  return useContext(GlossaryContext);
}

type Props = {
  children: ReactNode;
  terms: GlossaryTerm[];
};

export function GlossaryProvider({ children, terms }: Props) {
  const [activeTerm, setActiveTerm] = useState<GlossaryTerm | null>(null);

  const open = useCallback(
    (termId: string) => {
      const found = terms.find((t) => t.id === termId);
      if (found) {
        trackEvent("glossary_term_opened", { term: found.term, source: "id" });
        setActiveTerm(found);
      }
    },
    [terms]
  );

  const openByName = useCallback(
    (name: string) => {
      const lower = name.toLowerCase();
      const found = terms.find((t) => t.term.toLowerCase() === lower);
      if (found) {
        trackEvent("glossary_term_opened", { term: found.term, source: "name" });
        setActiveTerm(found);
      }
    },
    [terms]
  );

  return (
    <GlossaryContext.Provider value={{ terms, open, openByName }}>
      {children}
      {activeTerm && (
        <GlossaryDrawer term={activeTerm} onClose={() => setActiveTerm(null)} />
      )}
    </GlossaryContext.Provider>
  );
}

function GlossaryDrawer({
  term,
  onClose,
}: {
  term: GlossaryTerm;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-drawer-title"
        className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg rounded-t-2xl bg-white shadow-2xl ring-1 ring-[#e5e0d8] sm:bottom-auto sm:left-auto sm:right-8 sm:top-1/2 sm:w-[420px] sm:-translate-y-1/2 sm:rounded-2xl"
        style={{ animation: "slideUp 0.22s ease-out" }}
      >
        {/* Handle bar (mobile) */}
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-[#d5d0c8] sm:hidden" />

        <div className="p-6">
          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close explanation"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#f8f5ef] text-[#4a6a5a] transition hover:bg-[#e8e4db] hover:text-[#1a3a2a]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>

          {/* Official term badge */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f0eb] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#2d6a4a]">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="currentColor"
                className="opacity-70"
              >
                <circle cx="5" cy="5" r="5" />
              </svg>
              Official term
            </span>
          </div>

          {/* Term name */}
          <h2
            id="glossary-drawer-title"
            className="text-xl font-semibold leading-snug text-[#1a3a2a]"
          >
            {term.term}
          </h2>

          {/* Divider */}
          <div className="my-4 border-t border-[#e5e0d8]" />

          {/* Plain English explanation */}
          <div className="mb-5">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
              In plain English
            </p>
            <p className="text-base leading-7 text-[#1a3a2a]">{term.explanation}</p>
          </div>

          {/* Example */}
          <div className="rounded-xl border border-[#d5d0c8] bg-[#f8f5ef] p-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
              Example
            </p>
            <p className="text-sm leading-6 text-[#1a3a2a]">{term.example}</p>
          </div>

          {/* Footer note */}
          <p className="mt-4 text-xs text-[#7a9a87]">
            This explanation sits beside the official HMRC term, not instead of it.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(12px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        @media (min-width: 640px) {
          @keyframes slideUp {
            from { transform: translateY(calc(-50% + 12px)); opacity: 0; }
            to   { transform: translateY(-50%); opacity: 1; }
          }
        }
      `}</style>
    </>
  );
}
