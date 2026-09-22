import type { OutlineEntry } from '@gprose/extension-outline';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import './outline.css';

/** Navigation does not change editor selection or document history. */
export function OutlineMenu({
  entries,
  availableKeys,
  activeKey,
  onNavigate,
  toolbarHeight,
}: {
  availableKeys: ReadonlySet<string>;
  entries: readonly OutlineEntry[];
  activeKey: string | null;
  onNavigate: (entry: OutlineEntry) => void;
  toolbarHeight: number;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null);

  const railViewport = useRef<HTMLSpanElement>(null);

  const panel = useRef<HTMLDivElement>(null),
    id = useId(),
    suppressFocus = useRef(false),
    keyboardFocus = useRef(false);

  const close = useCallback(() => {
    suppressFocus.current = true;
    trigger.current?.focus({ preventScroll: true });
    suppressFocus.current = false;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);

    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open) return;

    const list = panel.current,
      current = list?.querySelector<HTMLElement>('[aria-current="location"]');

    if (list && current) {
      const y = current.offsetTop;

      if (y < list.scrollTop || y + current.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = Math.max(0, y - list.clientHeight / 2);
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Reposition the active marker after navigation or opening the menu changes its DOM.
  }, [open, activeKey]);
  useLayoutEffect(() => {
    const rail = railViewport.current;

    if (!rail) return undefined;

    const reveal = () => {
      const index = entries.findIndex((entry) => entry.key === activeKey);

      if (index < 0) return;
      const y = index * 10;

      if (y < rail.scrollTop + 10 || y + 12 > rail.scrollTop + rail.clientHeight)
        rail.scrollTop = Math.max(0, y - rail.clientHeight / 2);
    };

    const observer = new ResizeObserver(reveal);
    observer.observe(rail);
    reveal();

    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Reposition the active marker after navigation or opening the menu changes its DOM.
  }, [entries, activeKey, open]);

  if (!entries.length) return null;

  return (
    <nav
      ref={root}
      className={`document-outline${open ? ' is-open' : ''}`}
      aria-label="Document outline"
      style={{
        top: `calc(50% + ${toolbarHeight / 2}px)`,
        maxHeight: `calc((100dvh - ${toolbarHeight}px) * .8)`,
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          keyboardFocus.current = false;
          suppressFocus.current = false;
          setOpen(true);
        }
      }}
      onPointerLeave={(e) => {
        if (
          e.pointerType === 'mouse' &&
          (!keyboardFocus.current || !root.current?.contains(document.activeElement))
        )
          setOpen(false);
      }}
      onPointerDownCapture={() => {
        keyboardFocus.current = false;
      }}
      onKeyDownCapture={() => {
        keyboardFocus.current = true;
      }}
      onFocusCapture={(e) => {
        keyboardFocus.current = e.target.matches(':focus-visible');

        if (suppressFocus.current) {
          suppressFocus.current = false;

          return;
        }

        setOpen(true);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        style={{
          height: entries.length * 10 + 24,
          maxHeight: `calc((100dvh - ${toolbarHeight}px) * .8)`,
        }}
        className="outline-trigger"
        aria-label="Open document outline"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              panel.current
                ?.querySelector<HTMLButtonElement>(
                  '[aria-current="location"],button:not(:disabled)',
                )
                ?.focus(),
            );
          }
        }}
      >
        <span ref={railViewport} className="outline-marks" aria-hidden="true">
          <span className="outline-mark-track" style={{ height: entries.length * 10 }}>
            {entries.map((entry, index) => (
              <span
                key={entry.key}
                className="outline-mark"
                data-active={entry.key === activeKey}
                data-pending={!availableKeys.has(entry.key)}
                style={{ top: index * 10, width: Math.max(7, 25 - (entry.level - 1) * 5) }}
              />
            ))}
          </span>
        </span>
        <span className="outline-mobile-icon" aria-hidden="true">
          ☰
        </span>
      </button>
      {open && (
        <div
          className="outline-panel"
          id={id}
          style={{ maxHeight: `calc((100dvh - ${toolbarHeight}px) * .8)` }}
        >
          <div
            className="outline-items"
            ref={panel}
            onKeyDown={(e) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;

              const buttons = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
                ],
                at = buttons.indexOf(
                  document.activeElement instanceof HTMLButtonElement
                    ? document.activeElement
                    : buttons[0],
                );

              const index =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? buttons.length - 1
                    : Math.max(
                        0,
                        Math.min(buttons.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)),
                      );

              e.preventDefault();
              buttons[index]?.focus();
            }}
          >
            {entries.map((entry) => (
              <button
                key={entry.key}
                data-outline-key={entry.key}
                disabled={!availableKeys.has(entry.key)}
                title={!availableKeys.has(entry.key) ? 'This section is still loading' : undefined}
                onMouseDown={(e) => e.preventDefault()}
                aria-current={entry.key === activeKey ? 'location' : undefined}
                style={{ paddingLeft: 12 + Math.min(entry.depth, 6) * 12 }}
                onClick={() => {
                  onNavigate(entry);

                  if (matchMedia('(pointer:coarse)').matches) close();
                }}
              >
                {entry.title.trim() || 'Untitled heading'}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
