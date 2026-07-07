import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Input } from "./ui";

const nav = [
  { to: "/", label: "Markets", exact: true },
  { to: "/portfolio", label: "Portfolio", exact: false },
];

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Markets";
  if (pathname.startsWith("/portfolio")) return "Portfolio";
  if (pathname.startsWith("/market/")) return "Market detail";
  return "Markets";
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 w-60 border-r border-border bg-bg p-4">
        <div className="flex h-8 items-center gap-2 px-3">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-sm font-medium">Prediction Analyzer</span>
        </div>
        <nav className="mt-6 flex flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                [
                  "flex h-8 items-center rounded-md px-3 text-sm transition-colors",
                  isActive
                    ? "bg-raised text-text"
                    : "text-text-muted hover:bg-raised hover:text-text",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 px-3">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Workspace
          </p>
          <p className="mt-2 text-sm text-text-faint">demo@analyzer.app</p>
        </div>
      </aside>

      <div className="ml-60 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <h1 className="text-base font-medium">{pageTitle(pathname)}</h1>
          <Input placeholder="Search markets…" className="w-60" />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
