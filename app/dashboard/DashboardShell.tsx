"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useMemo, useState } from "react";
import { useAccessibility } from "./AccessibilityProvider";
import { useGlossary } from "./GlossaryProvider";
import LogoutButton from "./LogoutButton";

type Props = {
  children: ReactNode;
  userEmail: string;
};

const mainNav = [
  { label: "Invoices", href: "/dashboard", icon: InvoiceIcon },
  { label: "Quotes", href: "/dashboard/quotes", icon: QuoteIcon },
  { label: "Records", href: "/dashboard/records", icon: RecordsIcon },
  { label: "Tax prep", href: "/dashboard/tax-prep", icon: TaxIcon },
];

const automationNav = [
  { label: "Repeating invoices", href: "/dashboard/invoices/repeating", icon: RepeatIcon },
  { label: "Payment reminders", href: "/dashboard?reminders=1", icon: BellIcon },
];

export default function DashboardShell({ children, userEmail }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { activeTerm } = useGlossary();

  const drawerOpen = helpOpen || Boolean(activeTerm);

  return (
    <div className="min-h-screen bg-[#f6f8f5] text-[#17251d]">
      <button
        type="button"
        data-testid="mobile-nav-open-button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-30 inline-flex h-10 items-center gap-2 rounded-md border border-[#d9ded8] bg-white px-3 text-sm font-semibold text-[#17251d] shadow-sm lg:hidden"
      >
        <MenuIcon />
        Menu
      </button>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          data-testid="mobile-nav-backdrop"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-[#dfe5df] bg-white transition-transform lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-[#edf0ec] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/dashboard"
              data-testid="nav-brand-link"
              className="flex items-center gap-3"
              onClick={() => setMobileOpen(false)}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#15803d] text-sm font-bold text-white">
                V
              </span>
              <span>
                <span className="block text-base font-semibold tracking-tight text-[#17251d]">
                  VibeCount
                </span>
                <span className="block max-w-44 truncate text-xs text-[#66756b]">
                  {userEmail}
                </span>
              </span>
            </Link>
            <button
              type="button"
              aria-label="Close navigation"
              data-testid="mobile-nav-close-button"
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-2 text-[#66756b] hover:bg-[#f2f5f1] lg:hidden"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="mt-4 flex h-10 items-center gap-2 rounded-md border border-[#d9ded8] bg-[#fbfcfb] px-3 text-sm text-[#6d776f]">
            <SearchIcon />
            <span>Find...</span>
            <kbd className="ml-auto rounded border border-[#d9ded8] bg-white px-1.5 py-0.5 text-xs">
              F
            </kbd>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavGroup>
            {mainNav.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(pathname, item.href)}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </NavGroup>

          <NavGroup title="Automation">
            {automationNav.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isActive(pathname, item.href)}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </NavGroup>

          <NavGroup title="Support">
            <button
              type="button"
              data-testid="nav-help-button"
              onClick={() => {
                setHelpOpen(true);
                setMobileOpen(false);
              }}
              className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-[#4e5a52] transition hover:bg-[#f2f5f1] hover:text-[#17251d]"
            >
              <HelpIcon />
              Help
            </button>
            <NavLink
              href="/dashboard/glossary"
              label="Explain Simply"
              icon={BookIcon}
              active={isActive(pathname, "/dashboard/glossary")}
              onNavigate={() => setMobileOpen(false)}
            />
          </NavGroup>
        </nav>

        <div className="border-t border-[#edf0ec] px-3 py-4">
          <NavLink
            href="/dashboard/settings"
            label="Settings"
            icon={SettingsIcon}
            active={isActive(pathname, "/dashboard/settings")}
            onNavigate={() => setMobileOpen(false)}
          />
          <div className="mt-2 px-3">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="lg:pl-[280px]">
        <main className="dashboard-content min-h-screen px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <HelpDrawer open={drawerOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const glossary = useGlossary();
  const accessibility = useAccessibility();
  const visibleTerms = useMemo(() => glossary.terms.slice(0, 8), [glossary.terms]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close help"
        data-testid="help-drawer-backdrop"
        onClick={() => {
          glossary.close();
          onClose();
        }}
        className="fixed inset-0 z-40 bg-black/20"
      />
      <aside className="fixed bottom-0 right-0 z-50 max-h-[88vh] w-full overflow-y-auto rounded-t-lg border border-[#dfe5df] bg-white shadow-2xl sm:bottom-4 sm:right-4 sm:max-h-[calc(100vh-2rem)] sm:w-[420px] sm:rounded-lg">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#edf0ec] bg-white px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[#17251d]">Help</p>
            <p className="text-xs text-[#66756b]">Plain-English support when you need it.</p>
          </div>
          <button
            type="button"
            data-testid="help-drawer-close-button"
            onClick={() => {
              glossary.close();
              onClose();
            }}
            className="rounded-md p-2 text-[#66756b] hover:bg-[#f2f5f1]"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {glossary.activeTerm ? (
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Explain Simply
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[#17251d]">
                {glossary.activeTerm.term}
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#3f4d43]">
                {glossary.activeTerm.explanation}
              </p>
              <div className="mt-4 rounded-md border border-[#dfe5df] bg-[#f8faf7] p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[#66756b]">
                  Example
                </p>
                <p className="mt-2 text-sm leading-6 text-[#3f4d43]">
                  {glossary.activeTerm.example}
                </p>
              </div>
            </section>
          ) : (
            <section>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#15803d]">
                Current page
              </p>
              <p className="mt-2 text-sm leading-6 text-[#3f4d43]">
                Use Help for finance terms, page tips, and reading preferences. Main
                workflows stay focused until you ask for extra explanation.
              </p>
            </section>
          )}

          <section>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#66756b]">
              Glossary
            </p>
            <div className="mt-3 grid gap-2">
              {visibleTerms.map((term) => (
                <button
                  key={term.id}
                  type="button"
                  data-testid={`help-glossary-term-${term.id}`}
                  onClick={() => glossary.open(term.id)}
                  className="rounded-md border border-[#dfe5df] px-3 py-2 text-left text-sm font-medium text-[#17251d] hover:border-[#a7c5ad] hover:bg-[#f6fbf7]"
                >
                  {term.term}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#66756b]">
              Accessibility
            </p>
            <div className="mt-3 space-y-3">
              <ToggleRow
                label="Large text"
                testId="accessibility-large-text-toggle"
                checked={accessibility.textSize === "large"}
                onChange={(checked) => accessibility.setTextSize(checked ? "large" : "default")}
              />
              <ToggleRow
                label="Relaxed spacing"
                testId="accessibility-relaxed-spacing-toggle"
                checked={accessibility.spacing === "relaxed"}
                onChange={(checked) => accessibility.setSpacing(checked ? "relaxed" : "default")}
              />
              <ToggleRow
                label="Plain language notes"
                testId="accessibility-plain-language-toggle"
                checked={accessibility.plainLanguage}
                onChange={accessibility.setPlainLanguage}
              />
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}

function ToggleRow({
  label,
  testId,
  checked,
  onChange,
}: {
  label: string;
  testId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-[#dfe5df] bg-[#fbfcfb] px-3 py-2.5 text-sm font-medium text-[#17251d]">
      {label}
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#15803d]"
      />
    </label>
  );
}

function NavGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-5 border-b border-[#edf0ec] pb-5 last:border-b-0">
      {title ? (
        <p className="mb-2 px-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#7b877e]">
          {title}
        </p>
      ) : null}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof InvoiceIcon;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      data-testid={`nav-${slugifyTestId(label)}-link`}
      onClick={onNavigate}
      className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition ${
        active
          ? "bg-[#e9eee8] text-[#17251d]"
          : "text-[#4e5a52] hover:bg-[#f2f5f1] hover:text-[#17251d]"
      }`}
    >
      <Icon />
      {label}
    </Link>
  );
}

function slugifyTestId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

function InvoiceIcon() { return <IconSvg><path d="M5 2.5h8v13H5z" stroke="currentColor" strokeWidth="1.6"/><path d="M7 6h4M7 9h4M7 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function QuoteIcon() { return <IconSvg><path d="M4 4.5h10v7H8l-4 3v-10z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M7 7h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function RecordsIcon() { return <IconSvg><path d="M3 4h12M3 9h12M3 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M5 2v14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></IconSvg>; }
function TaxIcon() { return <IconSvg><path d="M4 14h10M5 11l3-7 2.5 5 1.5-3 2 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></IconSvg>; }
function RepeatIcon() { return <IconSvg><path d="M5 5h7l-2-2M13 13H6l2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 5v3M5 13v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function BellIcon() { return <IconSvg><path d="M5 13h8M6 13V8a3 3 0 016 0v5M8 15a1.2 1.2 0 002 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function HelpIcon() { return <IconSvg><path d="M9 15A6 6 0 109 3a6 6 0 000 12z" stroke="currentColor" strokeWidth="1.6"/><path d="M7.5 7.2A1.7 1.7 0 019 6.2c1 0 1.8.7 1.8 1.6 0 1.3-1.4 1.5-1.4 2.6M9 12.5h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function BookIcon() { return <IconSvg><path d="M4 3.5h6a2 2 0 012 2v9H6a2 2 0 01-2-2v-9z" stroke="currentColor" strokeWidth="1.6"/><path d="M12 5h2v9h-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function SettingsIcon() { return <IconSvg><path d="M9 11.5A2.5 2.5 0 109 6.5a2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.6"/><path d="M9 2.5v2M9 13.5v2M3.4 5.8l1.7 1M12.9 11.2l1.7 1M3.4 12.2l1.7-1M12.9 6.8l1.7-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function MenuIcon() { return <IconSvg><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
function CloseIcon() { return <IconSvg><path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></IconSvg>; }
function SearchIcon() { return <IconSvg><path d="M8 13a5 5 0 100-10 5 5 0 000 10zM12 12l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></IconSvg>; }
