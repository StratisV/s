import type { Kid } from '../types';
import styles from './KidAvatar.module.css';

interface KidAvatarProps {
  kid: Pick<Kid, 'avatar' | 'colour' | 'name'>;
  size?: number;
  /** Show the name to screen readers (off when the name is written next to it). */
  labelled?: boolean;
  ring?: boolean;
}

/** A kid's emoji in a circle of their colour. */
export function KidAvatar({ kid, size = 40, labelled = false, ring = false }: KidAvatarProps) {
  return (
    <span
      className={styles.avatar}
      data-colour={kid.colour}
      data-ring={ring || undefined}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? kid.name : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {kid.avatar}
    </span>
  );
}
