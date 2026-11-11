import { useState, useEffect } from 'react'
import ParticleCanvas from './components/ParticleCanvas'
import Navbar from './components/Navbar'
import AuthModal from './components/AuthModal'
import HomePage from './pages/HomePage'
import GamesPage from './pages/GamesPage'
import FavoritesPage from './pages/FavoritesPage'
import { getStoredUser, clearSession } from './lib/auth'
import styles from './App.module.css'

type Page = 'home' | 'games' | 'favorites' | 'settings'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [showAuth, setShowAuth] = useState(false)
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    const user = getStoredUser()
    if (user) setUsername(user.username)
  }, [])

  function handleAuthClick() {
    if (username) {
      clearSession()
      setUsername(null)
    } else {
      setShowAuth(true)
    }
  }

  return (
    <div className={styles.app}>
      <ParticleCanvas />
      <Navbar
        page={page}
        onNavigate={setPage}
        username={username}
        onAuthClick={handleAuthClick}
      />

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={(name) => setUsername(name)}
        />
      )}

      <main className={styles.main}>
        {page === 'home'      && <HomePage onNavigate={setPage} username={username} />}
        {page === 'games'     && <GamesPage loggedIn={!!username} />}
        {page === 'favorites' && <FavoritesPage loggedIn={!!username} onAuthClick={() => setShowAuth(true)} />}
        {page === 'settings'  && (
          <div className={styles.placeholder}>
            <p>settings coming soon</p>
          </div>
        )}
      </main>

      <div className={styles.onlineCount}>
        nero
      </div>
    </div>
  )
}
