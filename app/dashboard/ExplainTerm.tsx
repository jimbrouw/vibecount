"use client";

import { useGlossary } from "./GlossaryProvider";

type Props = {
  term: string;
  children: React.ReactNode;
};

/**
 * Wraps any text node that is also a known glossary term.
 * Tapping the text opens the Explain Simply drawer.
 * The official wording is always visible — this never hides it.
 */
export default function ExplainTerm({ term, children }: Props) {
  const { openByName } = useGlossary();

  return (
    <button
      type="button"
      onClick={() => openByName(term)}
      title={`Explain: ${term}`}
      className="inline cursor-pointer border-b-2 border-dotted border-[#7aaf8a] pb-px text-inherit transition-colors hover:border-[#2d6a4a] hover:text-[#2d6a4a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2d6a4a] focus-visible:ring-offset-1"
    >
      {children}
    </button>
  );
}
