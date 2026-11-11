import type { GameEntry } from '../lib/games'
import styles from './GameModal.module.css'

interface GameModalProps {
  game: GameEntry
  onClose: () => void
}

export default function GameModal({ game, onClose }: GameModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.bar}>
          <span className={styles.title}>{game.name}</span>
          <div className={styles.barRight}>
            <a
              href={game.gameUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.barBtn}
              title="open in new tab"
            >
              ↗
            </a>
            <button className={styles.barBtn} onClick={onClose} title="close">✕</button>
          </div>
        </div>
        {game.isExternal ? (
          <div className={styles.external}>
            <p>this game can't be embedded.</p>
            <a href={game.gameUrl} target="_blank" rel="noopener noreferrer" className={styles.openBtn}>
              open game ↗
            </a>
          </div>
        ) : (
          <iframe
            src={game.gameUrl}
            title={game.name}
            className={styles.frame}
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
          />
        )}
      </div>
    </div>
  )
}
