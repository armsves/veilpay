export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-hidden
    />
  );
}

export function BusyLabel({
  busy,
  idle,
  busyText = "Working…",
}: {
  busy: boolean;
  idle: string;
  busyText?: string;
}) {
  if (!busy) return <>{idle}</>;
  return (
    <span className="inline-flex items-center gap-2">
      <Spinner />
      {busyText}
    </span>
  );
}
