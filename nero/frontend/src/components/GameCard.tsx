import { useState, memo } from 'react'
import type { GameEntry } from '../lib/games'
import styles from './GameCard.module.css'

interface GameCardProps {
  game: GameEntry
  isFav?: boolean
  onPlay: (game: GameEntry) => void
  onFavToggle?: (game: GameEntry) => void
}

export default memo(function GameCard({ game, isFav, onPlay, onFavToggle }: GameCardProps) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)

  return (
    <article className={styles.card} onClick={() => onPlay(game)}>
      <div className={`${styles.cover} ${!loaded && !errored ? styles.skeleton : ''} ${errored ? styles.noCover : ''}`}>
        {game.coverUrl && !errored && (
          <img
            loading="lazy"
            decoding="async"
            src={game.coverUrl}
            alt={game.name}
            onLoad={() => setLoaded(true)}
            onError={() => { setLoaded(true); setErrored(true) }}
          />
        )}
        {errored && <span className={styles.noImg}>🎮</span>}
        {onFavToggle && (
          <button
            className={`${styles.fav} ${isFav ? styles.favActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onFavToggle(game) }}
            title={isFav ? 'remove from favorites' : 'add to favorites'}
          >
            {isFav ? '♥' : '♡'}
          </button>
        )}
      </div>
      <div className={styles.info}>
        <span className={styles.name}>{game.name}</span>
        {game.author && <span className={styles.author}>{game.author}</span>}
      </div>
    </article>
  )
})
