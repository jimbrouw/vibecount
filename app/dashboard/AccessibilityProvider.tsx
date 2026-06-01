"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

type TextSize = "default" | "large";
type Spacing = "default" | "relaxed";

type AccessibilityPreferences = {
  textSize: TextSize;
  spacing: Spacing;
  plainLanguage: boolean;
};

type AccessibilityContextValue = AccessibilityPreferences & {
  setTextSize: (value: TextSize) => void;
  setSpacing: (value: Spacing) => void;
  setPlainLanguage: (value: boolean) => void;
};

const STORAGE_KEY = "vibecount-accessibility";

const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  textSize: "default",
  spacing: "default",
  plainLanguage: false,
};

const AccessibilityContext = createContext<AccessibilityContextValue>({
  ...DEFAULT_PREFERENCES,
  setTextSize: () => {},
  setSpacing: () => {},
  setPlainLanguage: () => {},
});

export function useAccessibility() {
  return useContext(AccessibilityContext);
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PREFERENCES;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PREFERENCES;

      const parsed = JSON.parse(raw) as Partial<AccessibilityPreferences>;
      return {
        textSize: parsed.textSize === "large" ? "large" : "default",
        spacing: parsed.spacing === "relaxed" ? "relaxed" : "default",
        plainLanguage: Boolean(parsed.plainLanguage),
      };
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return DEFAULT_PREFERENCES;
    }
  });

  useEffect(() => {
    document.documentElement.dataset.textSize = preferences.textSize;
    document.documentElement.dataset.spacing = preferences.spacing;
    document.documentElement.dataset.plainLanguage = preferences.plainLanguage
      ? "on"
      : "off";
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const value = useMemo(
    () => ({
      ...preferences,
      setTextSize: (textSize: TextSize) =>
        setPreferences((current) => ({ ...current, textSize })),
      setSpacing: (spacing: Spacing) =>
        setPreferences((current) => ({ ...current, spacing })),
      setPlainLanguage: (plainLanguage: boolean) =>
        setPreferences((current) => ({ ...current, plainLanguage })),
    }),
    [preferences]
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
}
