"use client";

import { useCallback, useEffect, useRef } from "react";

// Textarea that grows with its content instead of scrolling.
export function GrowingTextarea({
  defaultValue,
  onBlur,
}: {
  defaultValue: string;
  onBlur: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [resize]);

  return (
    <textarea
      ref={ref}
      defaultValue={defaultValue}
      onInput={resize}
      onBlur={(e) => onBlur(e.target.value)}
      rows={3}
      className="w-full overflow-hidden rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs focus:border-emerald-500 outline-none resize-none"
    />
  );
}
