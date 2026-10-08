import styles from './HomeScene.module.css';

/**
 * The home scene card: a duck and a hedgehog living in a house (README
 * "Home scene card"). Used on Home and on the Welcome screen. The animals
 * stay still with Reduce Motion. A commissioned illustration can replace
 * the emoji later; keep the same placement.
 */
export function HomeScene({ height = 150 }: { height?: number }) {
  return (
    <div className={styles.scene} style={{ height }} role="img" aria-label="A duck and a hedgehog outside their house">
      <span className={styles.sun} />
      <span className={styles.house}>🏡</span>
      <span className={styles.duck}>🦆</span>
      <span className={styles.hedgehog}>🦔</span>
    </div>
  );
}
