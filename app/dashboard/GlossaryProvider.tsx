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
  activeTerm: GlossaryTerm | null;
  open: (termId: string) => void;
  openByName: (name: string) => void;
  close: () => void;
};

const GlossaryContext = createContext<GlossaryContextValue>({
  terms: [],
  activeTerm: null,
  open: () => {},
  openByName: () => {},
  close: () => {},
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
    <GlossaryContext.Provider
      value={{ terms, activeTerm, open, openByName, close: () => setActiveTerm(null) }}
    >
      {children}
    </GlossaryContext.Provider>
  );
}
