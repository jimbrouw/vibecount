"use client";

import { ReactNode } from "react";
import { useAccessibility } from "./AccessibilityProvider";

export default function PlainLanguageNote({ children }: { children: ReactNode }) {
  const { plainLanguage } = useAccessibility();

  if (!plainLanguage) {
    return null;
  }

  return <p className="plain-language-note">{children}</p>;
}
