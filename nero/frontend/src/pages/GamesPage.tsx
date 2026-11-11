import { useState, useEffect, useCallback, useMemo } from 'react'
import GameCard from '../components/GameCard'
import GameModal from '../components/GameModal'
import { fetchGames, getActiveSource, setActiveSource, type GameEntry, type SourceKey } from '../lib/games'
import { addFavorite, removeFavorite, getFavorites } from '../lib/favorites'
import styles from './GamesPage.module.css'

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: 'selenite', label: 'selenite' },
  { key: 'gn-math',  label: 'gn-math' },
  { key: 'velara',   label: 'velara' },
  { key: 'edurocks', label: 'edurocks' },
  { key: 'truffled', label: 'truffled' },
]

interface GamesPageProps {
  loggedIn: boolean
}

export default function GamesPage({ loggedIn }: GamesPageProps) {
  const [games, setGames] = useState<GameEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceKey>(getActiveSource())
  const [active, setActive] = useState<GameEntry | null>(null)
  const [favIds, setFavIds] = useState<Set<string>>(new Set())

  const load = useCallback((src: SourceKey) => {
    setLoading(true); setError(null)
    fetchGames(src)
      .then((g) => { setGames(g); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  useEffect(() => { load(source) }, [source, load])

  useEffect(() => {
    if (!loggedIn) return
    getFavorites()
      .then((favs) => setFavIds(new Set(favs.map((f) => f.game_id))))
      .catch(() => {})
  }, [loggedIn])

  const filtered = useMemo(() => {
    if (!query.trim()) return games
    const q = query.toLowerCase()
    return games.filter(
      (g) => g._nameLc?.includes(q) || g._authorLc?.includes(q)
    )
  }, [games, query])

  function changeSource(src: SourceKey) {
    setActiveSource(src); setSource(src); setQuery('')
  }

  async function toggleFav(game: GameEntry) {
    if (!loggedIn) return
    const id = String(game.id)
    if (favIds.has(id)) {
      await removeFavorite(id).catch(() => {})
      setFavIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    } else {
      await addFavorite(game).catch(() => {})
      setFavIds((prev) => new Set([...prev, id]))
    }
  }

  return (
    <div className={styles.page}>
      {active && <GameModal game={active} onClose={() => setActive(null)} />}

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>⌕</span>
          <input
            className={styles.search}
            placeholder="search games..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.sources}>
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`${styles.sourceBtn} ${source === s.key ? styles.activeSource : ''}`}
              onClick={() => changeSource(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className={styles.error}>failed to load games — {error}</p>}

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={styles.skeletonCover} />
              <div className={styles.skeletonInfo} />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((game) => (
            <GameCard
              key={`${game.sourceKey}-${game.id}`}
              game={game}
              isFav={favIds.has(String(game.id))}
              onPlay={setActive}
              onFavToggle={loggedIn ? toggleFav : undefined}
            />
          ))}
        </div>
      )}

      <div className={styles.count}>
        {!loading && `${filtered.length.toLocaleString()} games`}
      </div>
    </div>
  )
}
