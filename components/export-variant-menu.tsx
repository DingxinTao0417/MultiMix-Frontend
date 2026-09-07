"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ExportVariant } from "@/lib/brand-showcase";

export type ExportVariantOption = {
  variant: ExportVariant;
  label: string;
  disabled?: boolean;
};

export function ExportVariantMenu({
  triggerLabel,
  options,
  onSelect,
  disabled = false,
  triggerClassName = "",
  menuAriaLabel = "选择导出版本",
}: {
  triggerLabel: string;
  options: ExportVariantOption[];
  onSelect: (variant: ExportVariant) => void | Promise<void>;
  disabled?: boolean;
  triggerClassName?: string;
  menuAriaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    firstOptionRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <span className="multimix-export-variant-menu" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{triggerLabel}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <span className="multimix-export-variant-popover" role="menu" aria-label={menuAriaLabel}>
          {options.map((option, index) => (
            <button
              key={option.variant}
              ref={index === 0 ? firstOptionRef : undefined}
              type="button"
              role="menuitem"
              disabled={option.disabled}
              onClick={() => {
                setOpen(false);
                void onSelect(option.variant);
              }}
            >
              {option.label}
            </button>
          ))}
          <a href="/brand/multimix-brand-kit.zip" role="menuitem" download>
            下载 MultiMix 品牌包
          </a>
        </span>
      ) : null}
    </span>
  );
}
