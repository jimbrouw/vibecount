"use client";

import { useState } from "react";

type Term = {
  id: string;
  term: string;
  explanation: string;
  example: string;
};

type Props = {
  terms: Term[];
};

export default function GlossaryBrowser({ terms }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered =
    query.trim() === ""
      ? terms
      : terms.filter(
          (t) =>
            t.term.toLowerCase().includes(query.toLowerCase()) ||
            t.explanation.toLowerCase().includes(query.toLowerCase())
        );

  return (
    <div>
      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7a9a87]"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <line
              x1="11"
              y1="11"
              x2="14"
              y2="14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search terms…"
            className="h-12 w-full rounded-xl border border-[#d5d0c8] bg-white pl-10 pr-4 text-base text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]"
          />
        </div>
      </div>

      {/* Term list */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-[#7a9a87]">
          No terms match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((term) => {
            const isOpen = expanded === term.id;
            return (
              <li key={term.id}>
                <div className="overflow-hidden rounded-xl border border-[#e5e0d8] bg-white shadow-sm transition-shadow hover:shadow-md">
                  {/* Header — always visible (official term) */}
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : term.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between px-5 py-4 text-left"
                    id={`term-header-${term.id}`}
                    aria-controls={`term-body-${term.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#e8f0eb]">
                        <span className="h-2 w-2 rounded-full bg-[#2d6a4a]" />
                      </span>
                      <span className="text-base font-semibold text-[#1a3a2a]">
                        {term.term}
                      </span>
                    </div>
                    <ChevronIcon open={isOpen} />
                  </button>

                  {/* Expandable body */}
                  <div
                    id={`term-body-${term.id}`}
                    role="region"
                    aria-labelledby={`term-header-${term.id}`}
                    hidden={!isOpen}
                  >
                    <div className="border-t border-[#f0ece4] px-5 pb-5 pt-4">
                      {/* Plain English */}
                      <div className="mb-4">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
                          In plain English
                        </p>
                        <p className="text-sm leading-7 text-[#1a3a2a]">
                          {term.explanation}
                        </p>
                      </div>

                      {/* Example */}
                      <div className="rounded-lg border border-[#d5d0c8] bg-[#f8f5ef] p-4">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
                          Example
                        </p>
                        <p className="text-sm leading-6 text-[#1a3a2a]">{term.example}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer note */}
      <p className="mt-8 text-xs text-[#7a9a87]">
        {filtered.length} of {terms.length} terms shown. Explanations are written beside
        official wording, not instead of it.
      </p>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={`flex-shrink-0 text-[#4a6a5a] transition-transform duration-200 ${
        open ? "rotate-180" : "rotate-0"
      }`}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
