import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/* Shared primitives implementing DESIGN.md §4 exactly. */

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("bg-surface border border-border rounded-lg", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        {description ? (
          <p className="text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-text hover:bg-accent-hover",
  secondary: "bg-raised border border-border text-text hover:border-text-faint",
  ghost: "text-text-muted hover:text-text hover:bg-raised",
  danger: "bg-error-muted text-error border border-transparent hover:border-error",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cx(
        "h-8 px-3 rounded-md text-sm font-medium inline-flex items-center gap-2 transition-colors",
        buttonVariants[variant],
        props.disabled && "opacity-50 pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

type BadgeTone = "success" | "error" | "accent" | "warning" | "neutral";

const badgeTones: Record<BadgeTone, string> = {
  success: "bg-success-muted text-success",
  error: "bg-error-muted text-error",
  accent: "bg-accent-muted text-accent",
  warning: "bg-warning-muted text-warning",
  neutral: "bg-raised text-text-muted",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-8 bg-raised border border-border rounded-md px-3 text-sm placeholder:text-text-faint focus:border-accent focus:outline-none",
        props.className,
      )}
    />
  );
}

export function StatCard({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "success" | "error";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p className="num mt-1 text-lg font-semibold">{value}</p>
      {delta ? (
        <p
          className={cx(
            "num mt-1 text-sm",
            deltaTone === "error" ? "text-error" : "text-success",
          )}
        >
          {delta}
        </p>
      ) : null}
    </Card>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children?: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cx(
        "bg-surface px-4 py-3 text-xs font-medium uppercase tracking-wider text-text-muted",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  numeric = false,
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cx(
        "px-4 py-3 text-sm",
        align === "right" ? "text-right" : "text-left",
        numeric && "num",
        className,
      )}
    >
      {children}
    </td>
  );
}
