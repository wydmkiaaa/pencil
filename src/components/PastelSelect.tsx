import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface PastelSelectOption {
  value: string;
  label: string;
  color?: string;
}

interface PastelSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: PastelSelectOption[];
  ariaLabel?: string;
  variant?: 'pill' | 'field';
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
}

export const PastelSelect: React.FC<PastelSelectProps> = ({
  value,
  onChange,
  options,
  ariaLabel,
  variant = 'field',
  align = 'left',
  className = '',
  menuClassName = '',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const triggerBase =
    variant === 'pill'
      ? 'px-4 py-2 text-xs font-bold rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)] hover:bg-[var(--pastel-soft)]'
      : 'px-4 py-2 text-xs sm:text-sm font-semibold rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] hover:bg-[var(--pastel-soft)]/70';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2.5 text-[var(--pastel-ink)] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pastel-accent)]/30 ${triggerBase}`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {selected?.color && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
          )}
          <span className="truncate">{selected?.label ?? ''}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--pastel-muted)] shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className={`absolute z-50 mt-2 min-w-full w-max max-w-[260px] max-h-64 overflow-y-auto p-1.5 rounded-3xl border border-[var(--pastel-border)] bg-[var(--pastel-surface)] shadow-xl shadow-black/8 space-y-0.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3.5 py-2 rounded-2xl text-xs flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--pastel-soft)] text-[var(--pastel-ink)] font-bold'
                    : 'text-[var(--pastel-ink)] hover:bg-[var(--pastel-canvas)] font-semibold'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {opt.color && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: opt.color }}
                    />
                  )}
                  <span className="truncate">{opt.label}</span>
                </span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[var(--pastel-accent)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
