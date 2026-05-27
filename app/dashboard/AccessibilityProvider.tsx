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
      <AccessibilityToolbar />
    </AccessibilityContext.Provider>
  );
}

function AccessibilityToolbar() {
  const {
    textSize,
    spacing,
    plainLanguage,
    setTextSize,
    setSpacing,
    setPlainLanguage,
  } = useAccessibility();
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))]">
      {open ? (
        <section className="rounded-2xl border border-[#d5d0c8] bg-white/95 p-4 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1a3a2a]">Accessibility</p>
              <p className="text-xs text-[#4a6a5a]">
                Text size, reading spacing, and simpler guidance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-[#f5f0e8] px-2.5 py-1 text-xs font-medium text-[#4a6a5a]"
            >
              Close
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Text size
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ToolbarOption
                  active={textSize === "default"}
                  onClick={() => setTextSize("default")}
                  label="Standard"
                />
                <ToolbarOption
                  active={textSize === "large"}
                  onClick={() => setTextSize("large")}
                  label="Large"
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Reading spacing
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ToolbarOption
                  active={spacing === "default"}
                  onClick={() => setSpacing("default")}
                  label="Normal"
                />
                <ToolbarOption
                  active={spacing === "relaxed"}
                  onClick={() => setSpacing("relaxed")}
                  label="Relaxed"
                />
              </div>
            </div>

            <label className="flex items-center justify-between rounded-xl border border-[#e5e0d8] bg-[#f8f5ef] px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-[#1a3a2a]">Plain language</p>
                <p className="text-xs text-[#4a6a5a]">
                  Show extra short explanations in forms and summaries.
                </p>
              </div>
              <button
                type="button"
                aria-pressed={plainLanguage}
                onClick={() => setPlainLanguage(!plainLanguage)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  plainLanguage ? "bg-[#2d6a4a]" : "bg-[#d5d0c8]"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    plainLanguage ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="ml-auto flex items-center gap-2 rounded-full border border-[#d5d0c8] bg-white/95 px-4 py-2 text-sm font-medium text-[#1a3a2a] shadow-lg backdrop-blur"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e8f0eb] text-[#2d6a4a]">
          A
        </span>
        Accessibility
      </button>
    </div>
  );
}

function ToolbarOption({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-[#1a3a2a] text-white"
          : "border border-[#d5d0c8] bg-white text-[#1a3a2a]"
      }`}
    >
      {label}
    </button>
  );
}
