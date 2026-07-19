"use client";

import { useCallback, useEffect, useRef } from "react";

// Textarea that grows with its content instead of scrolling.
export function GrowingTextarea({
  defaultValue,
  onBlur,
  templates,
}: {
  defaultValue: string;
  onBlur: (value: string) => void;
  templates?: { label: string; body: string }[];
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

  // drop a breakdown template into the note, appending after any existing text,
  // then persist right away (the save upstream is de-duped, so this is safe)
  function insertTemplate(body: string) {
    const el = ref.current;
    if (!el) return;
    const cur = el.value.replace(/\s+$/, "");
    el.value = cur ? `${cur}\n\n${body}` : body;
    resize();
    onBlur(el.value);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }

  return (
    <div className="space-y-1">
      {templates && templates.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {templates.map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => insertTemplate(tpl.body)}
              className="text-[10px] uppercase tracking-wide border border-neutral-700 text-neutral-500 rounded px-1.5 py-0.5 hover:bg-neutral-800 hover:text-neutral-300"
            >
              + {tpl.label}
            </button>
          ))}
        </div>
      )}
    <textarea
      ref={ref}
      defaultValue={defaultValue}
      onInput={resize}
      onBlur={(e) => onBlur(e.target.value)}
      rows={3}
      className="w-full overflow-hidden rounded-md bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs focus:border-emerald-500 outline-none resize-none"
    />
    </div>
  );
}
