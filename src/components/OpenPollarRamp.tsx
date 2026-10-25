"use client";

import { useEffect, useState } from "react";
import { usePollar } from "@pollar/react";

export function OpenPollarRamp({
  label = "Open Pollar ramp",
  className = "btn btn-primary",
}: {
  label?: string;
  className?: string;
}) {
  const key = process.env.NEXT_PUBLIC_POLLAR_KEY?.trim();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!key) {
    return (
      <button type="button" className={className} disabled title="Missing NEXT_PUBLIC_POLLAR_KEY">
        Pollar key missing
      </button>
    );
  }

  if (!mounted) {
    return (
      <button type="button" className={className} disabled>
        {label}
      </button>
    );
  }

  return <OpenPollarRampInner label={label} className={className} />;
}

function OpenPollarRampInner({ label, className }: { label: string; className: string }) {
  const { openRampModal } = usePollar();
  return (
    <button type="button" className={className} onClick={() => openRampModal()}>
      {label}
    </button>
  );
}
