import { useState, useEffect } from 'react'
import { getFavorites, removeFavorite, type Favorite } from '../lib/favorites'
import GameModal from '../components/GameModal'
import type { GameEntry } from '../lib/games'
import styles from './FavoritesPage.module.css'

interface FavoritesPageProps {
  loggedIn: boolean
  onAuthClick: () => void
}

export default function FavoritesPage({ loggedIn, onAuthClick }: FavoritesPageProps) {
  const [favs, setFavs] = useState<Favorite[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<GameEntry | null>(null)

  useEffect(() => {
    if (!loggedIn) { setLoading(false); return }
    getFavorites().then((f) => { setFavs(f); setLoading(false) }).catch(() => setLoading(false))
  }, [loggedIn])

  async function remove(gameId: string) {
    await removeFavorite(gameId).catch(() => {})
    setFavs((prev) => prev.filter((f) => f.game_id !== gameId))
  }

  if (!loggedIn) return (
    <div className={styles.empty}>
      <p>sign in to see your favorites</p>
      <button className={styles.signIn} onClick={onAuthClick}>sign in</button>
    </div>
  )

  if (loading) return <div className={styles.empty}><p>loading...</p></div>

  if (favs.length === 0) return (
    <div className={styles.empty}>
      <p>no favorites yet — heart a game to save it here</p>
    </div>
  )

  return (
    <div className={styles.page}>
      {active && <GameModal game={active} onClose={() => setActive(null)} />}
      <h2 className={styles.heading}>favorites</h2>
      <div className={styles.grid}>
        {favs.map((f) => {
          const game: GameEntry = {
            id: f.game_id, name: f.game_name, coverUrl: f.cover_url ?? '',
            gameUrl: f.game_url, isExternal: false, featured: false,
            sourceKey: f.source_key as any,
          }
          return (
            <div key={f.id} className={styles.card}>
              <div className={styles.cover} onClick={() => setActive(game)}>
                {f.cover_url
                  ? <img src={f.cover_url} alt={f.game_name} loading="lazy" />
                  : <span className={styles.noImg}>🎮</span>}
              </div>
              <div className={styles.info}>
                <span className={styles.name}>{f.game_name}</span>
                <div className={styles.row}>
                  <button className={styles.play} onClick={() => setActive(game)}>play</button>
                  <button className={styles.remove} onClick={() => remove(f.game_id)} title="remove">✕</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
