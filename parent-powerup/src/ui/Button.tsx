import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Take the whole width of its row. */
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', icon, block, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      data-icon-only={!children || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 18 : 20} />}
      {children && <span>{children}</span>}
    </button>
  );
}
