import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from './icons';
import styles from './Menu.module.css';

export interface MenuItem {
  key: string;
  label: string;
  /** Before the label (a person's emoji). */
  lead?: ReactNode;
  /** At the trailing edge, as iOS menus draw an action's symbol. */
  icon?: ReactNode;
  /** Quiet text at the trailing edge (a count). */
  detail?: string;
  /** The spoken name, when the visible text is not enough ("Shea, 6 items"). */
  ariaLabel?: string;
  /** A choice (menuitemradio): a check shows on the chosen one. */
  checked?: boolean;
  /** A hairline above it: the start of a new group of items. */
  groupStart?: boolean;
  onSelect(): void;
}

/** What the button that opens the menu needs: spread it onto a `<button>`. */
export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement>;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}

interface MenuProps {
  /** The menu's accessible name. */
  label: string;
  items: MenuItem[];
  /** Renders the button that opens it. */
  children(trigger: MenuTriggerProps): ReactNode;
}

/** How long the menu takes to fade away (Menu.module.css). */
const EXIT_MS = 160;
const EDGE = 12;
const GAP = 8;

/**
 * A pull-down menu, as iOS draws one: frosted glass that grows out of the button that opened
 * it, below the button (above it near the bottom of the screen), lined up with its trailing
 * edge. Items are actions (menuitem) or one choice among several (menuitemradio, a check on
 * the chosen one).
 *
 * Keyboard and assistive tech: the button says it has a menu and whether it is open; opening
 * focuses the chosen item (or the first); the arrow keys, Home and End move; Enter or Space
 * chooses; Escape or Tab closes it and focus goes back to the button. Choosing an item closes
 * it, puts focus back on the button, then runs the item (so a sheet it opens returns focus
 * there). A tap outside, a scroll or a resize closes it.
 */
export function Menu({ label, items, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusFirst = useRef<'chosen' | 'last'>('chosen');

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => {
      setMounted(false);
      setPlace(null);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Measured once drawn (hidden), then placed by the button and shown.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const t = trigger.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(EDGE, Math.min(t.right - w, vw - EDGE - w));
    const below = t.bottom + GAP + h <= vh - EDGE;
    const top = below ? t.bottom + GAP : Math.max(EDGE, t.top - GAP - h);
    const ox = Math.max(0, Math.min(w, t.left + t.width / 2 - left));
    setPlace({ left, top, origin: `${ox}px ${below ? 0 : h}px` });
  }, [open, mounted]);

  // Focus goes into the menu once it is placed.
  useEffect(() => {
    if (!open || !place) return;
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    const chosen = list.find((b) => b.getAttribute('aria-checked') === 'true');
    const target = focusFirst.current === 'last' ? list[list.length - 1] : (chosen ?? list[0]);
    target?.focus({ preventScroll: true });
  }, [open, place]);

  // A scroll or a resize leaves it behind: close it (focus stays where it is).
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  const choose = (item: MenuItem) => {
    close(true);
    item.onSelect();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    list[next]?.focus();
  };

  const trigger: MenuTriggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => {
      focusFirst.current = 'chosen';
      setOpen((o) => !o);
    },
    onKeyDown: (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      focusFirst.current = e.key === 'ArrowUp' ? 'last' : 'chosen';
      setOpen(true);
    },
  };

  const radio = items.some((it) => it.checked !== undefined);

  return (
    <>
      {children(trigger)}
      {mounted
        ? createPortal(
            <div className={styles.layer} data-open={(open && !!place) || undefined}>
              <div className={styles.backdrop} aria-hidden="true" onPointerDown={() => close(false)} onClick={() => close(false)} />
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={label}
                className={styles.menu}
                data-radio={radio || undefined}
                style={
                  place
                    ? { left: place.left, top: place.top, transformOrigin: place.origin }
                    : { left: 0, top: 0, visibility: 'hidden' }
                }
                onKeyDown={onMenuKeyDown}
              >
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                    aria-checked={item.checked}
                    aria-label={item.ariaLabel}
                    tabIndex={-1}
                    className={styles.item}
                    data-group-start={item.groupStart || undefined}
                    onClick={() => choose(item)}
                  >
                    {radio ? (
                      <span className={styles.check} aria-hidden="true">
                        {item.checked ? <CheckIcon size={17} strokeWidth={2.8} /> : null}
                      </span>
                    ) : null}
                    {item.lead ? (
                      <span className={styles.lead} aria-hidden="true">
                        {item.lead}
                      </span>
                    ) : null}
                    <span className={styles.label}>{item.label}</span>
                    {item.detail ? (
                      <span className={styles.detail} aria-hidden="true">
                        {item.detail}
                      </span>
                    ) : null}
                    {item.icon ? (
                      <span className={styles.icon} aria-hidden="true">
                        {item.icon}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
