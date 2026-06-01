import Link from "next/link";
import LogoutButton from "./LogoutButton";

type NavKey = "invoices" | "records" | "tax-prep" | "glossary" | "agent" | "settings";

const NAV_LINKS: { key: NavKey; href: string; label: string }[] = [
  { key: "invoices", href: "/dashboard", label: "Invoices" },
  { key: "records", href: "/dashboard/records", label: "Records" },
  { key: "tax-prep", href: "/dashboard/tax-prep", label: "Tax Prep" },
  { key: "glossary", href: "/dashboard/glossary", label: "Explain Simply" },
  { key: "agent", href: "/dashboard/agent", label: "Agent" },
  { key: "settings", href: "/dashboard/settings", label: "Settings" },
];

type Props = {
  active: NavKey;
  userEmail: string;
  children: React.ReactNode;
  className?: string;
};

export default function DashboardShell({ active, userEmail, children, className }: Props) {
  return (
    <main className={className ?? "min-h-screen bg-[#f5f0e8]"}>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#e5e0d8] bg-white px-6 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link
            href="/dashboard"
            className="text-lg font-semibold text-[#1a3a2a] transition hover:text-[#2d6a4a]"
          >
            VibeCount
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map(({ key, href, label }) => (
              <Link
                key={key}
                href={href}
                data-testid={`nav-${key}`}
                className={
                  active === key
                    ? "rounded-lg bg-[#e8f0eb] px-3 py-1.5 text-sm font-medium text-[#1a3a2a]"
                    : "rounded-lg px-3 py-1.5 text-sm text-[#4a6a5a] transition hover:bg-[#f0ece4] hover:text-[#1a3a2a]"
                }
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-[#4a6a5a] sm:block">{userEmail}</span>
          <LogoutButton />
        </div>
      </header>
      {children}
    </main>
  );
}
