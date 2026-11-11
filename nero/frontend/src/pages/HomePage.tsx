import styles from './HomePage.module.css'

type Page = 'home' | 'games' | 'favorites' | 'settings'

interface HomePageProps {
  onNavigate: (p: Page) => void
  username?: string | null
}

export default function HomePage({ onNavigate, username }: HomePageProps) {
  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.title}>nero</h1>
        <p className={styles.sub}>
          {username ? `welcome back, ${username}` : 'games, unblocked.'}
        </p>

        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => onNavigate('games')}>
            browse games
          </button>
          {username && (
            <button className={styles.secondary} onClick={() => onNavigate('favorites')}>
              my favorites
            </button>
          )}
        </div>

        <div className={styles.pills}>
          <span className={styles.pill}>🎮 games</span>
          <span className={styles.pill}>♥ favorites</span>
          <span className={styles.pill}>☁ free</span>
          <span className={styles.pill}>🔒 private</span>
        </div>
      </div>
    </div>
  )
}
