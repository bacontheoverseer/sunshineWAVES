import { apiFetch } from './games'
import type { GameEntry } from './games'

export interface Favorite {
  id: number
  game_id: string
  game_name: string
  game_url: string
  cover_url: string | null
  source_key: string
  added_at: string
}

export async function getFavorites(): Promise<Favorite[]> {
  const res = await apiFetch('/favorites')
  return res.json()
}

export async function addFavorite(game: GameEntry): Promise<void> {
  await apiFetch('/favorites', {
    method: 'POST',
    body: JSON.stringify({
      game_id: String(game.id),
      game_name: game.name,
      game_url: game.gameUrl,
      cover_url: game.coverUrl || null,
      source_key: game.sourceKey,
    }),
  })
}

export async function removeFavorite(gameId: string): Promise<void> {
  await apiFetch(`/favorites/${encodeURIComponent(gameId)}`, { method: 'DELETE' })
}
