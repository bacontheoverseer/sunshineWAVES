import styles from './Navbar.module.css'

type Page = 'home' | 'games' | 'favorites' | 'settings'

interface NavbarProps {
  page: Page
  onNavigate: (p: Page) => void
  username?: string | null
  onAuthClick: () => void
}

const icons: Record<Page, string> = {
  home:      '⌂',
  games:     '🎮',
  favorites: '♥',
  settings:  '⚙',
}

export default function Navbar({ page, onNavigate, username, onAuthClick }: NavbarProps) {
  return (
    <nav className={styles.nav}>
      <span className={styles.logo}>nero</span>

      <div className={styles.links}>
        {(['home', 'games', 'favorites'] as Page[]).map((p) => (
          <button
            key={p}
            className={`${styles.link} ${page === p ? styles.active : ''}`}
            onClick={() => onNavigate(p)}
            title={p}
          >
            <span className={styles.icon}>{icons[p]}</span>
            <span className={styles.label}>{p}</span>
          </button>
        ))}
      </div>

      <div className={styles.right}>
        <button className={styles.authBtn} onClick={onAuthClick}>
          {username ? username : 'sign in'}
        </button>
        <button
          className={`${styles.link} ${page === 'settings' ? styles.active : ''}`}
          onClick={() => onNavigate('settings')}
          title="settings"
        >
          <span className={styles.icon}>{icons.settings}</span>
        </button>
      </div>
    </nav>
  )
}
