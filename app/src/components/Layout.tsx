import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { formatAgo } from "../format";

const nav = [
  { to: "/", label: "Events", exact: true },
  { to: "/signals", label: "Signals", exact: false },
];

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Matched events";
  if (pathname.startsWith("/signals")) return "Mispricing signals";
  if (pathname.startsWith("/event/")) return "Event detail";
  return "Matched events";
}

function VenueDot({ label, fresh, latest }: { label: string; fresh: boolean; latest: string | null }) {
  return (
    <div className="flex items-center gap-2" title={`latest reading: ${formatAgo(latest)}`}>
      <span className={`h-2 w-2 rounded-full ${fresh ? "bg-success" : "bg-error"}`} />
      <span className="text-sm text-text-muted">{label}</span>
      <span className="num ml-auto text-xs text-text-faint">{formatAgo(latest)}</span>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const health = usePoll(api.health);
  const venues = health.data?.venues;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-border bg-bg p-4">
        <div className="flex h-8 items-center gap-2 px-3">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-sm font-medium">Mispricing Detector</span>
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
        <div className="mt-auto px-3 pb-2">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Pipeline
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {venues ? (
              <>
                <VenueDot
                  label="Kalshi"
                  fresh={venues.kalshi?.fresh ?? false}
                  latest={venues.kalshi?.latest_reading_at ?? null}
                />
                <VenueDot
                  label="Polymarket"
                  fresh={venues.polymarket?.fresh ?? false}
                  latest={venues.polymarket?.latest_reading_at ?? null}
                />
              </>
            ) : (
              <p className="text-sm text-text-faint">
                {health.error ? "API unreachable" : "Connecting…"}
              </p>
            )}
          </div>
        </div>
      </aside>

      <div className="ml-60 flex-1">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <h1 className="text-base font-medium">{pageTitle(pathname)}</h1>
          <span className="text-xs text-text-faint">
            Kalshi × Polymarket · live pipeline data
          </span>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
