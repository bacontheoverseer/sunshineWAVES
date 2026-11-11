// API base — in dev, Vite proxies /api → backend; in prod, same origin
export const API = '/api'

export async function apiFetch(path: string, init?: RequestInit) {
  const token = localStorage.getItem('nero_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, { ...init, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res
}

// ── Game sources ──────────────────────────────────────────────────────────────

export type SourceKey = 'selenite' | 'gn-math' | 'velara' | 'edurocks' | 'truffled'

export interface GameEntry {
  id: string | number
  name: string
  author?: string
  coverUrl: string
  gameUrl: string
  isExternal: boolean
  featured: boolean
  sourceKey: SourceKey
  _nameLc?: string
  _authorLc?: string
}

const proxy = (url: string) => `${API}/proxy?url=${encodeURIComponent(url)}`

const SOURCES = {
  selenite: {
    games: proxy('https://selenite.cc/resources/games.json'),
    assets: 'https://selenite.cc/resources/semag/',
  },
  'gn-math': {
    zones: proxy('https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json'),
    covers: 'https://cdn.jsdelivr.net/gh/freebuisness/covers@main',
    html: 'https://cdn.jsdelivr.net/gh/freebuisness/html@main',
  },
  velara: {
    games: proxy('https://velara.cc/data/games.json'),
    assets: 'https://velara.cc',
  },
  edurocks: {
    games: proxy('https://edunet.climaref.cl/gxxes.json'),
    assets: 'https://edunet.climaref.cl',
  },
  truffled: {
    games: proxy('https://truffled.lol/js/json/g.json'),
    base: 'https://truffled.lol',
  },
}

function coverProxy(url: string) {
  return `${API}/proxy?url=${encodeURIComponent(url)}`
}

function mapSelenite(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? data as any[] : []
  return games
    .filter((g) => g?.name && g?.directory)
    .map((g) => {
      const path = String(g.directory).replace(/^\/+/, '')
      const img = String(g.image || '').replace(/^\/+/, '')
      const rawCover = img ? `${SOURCES.selenite.assets}${path}/${img}` : ''
      return {
        id: g.name, name: g.name,
        coverUrl: rawCover ? coverProxy(rawCover) : '',
        gameUrl: `${SOURCES.selenite.assets}${path}`,
        isExternal: false, featured: false, sourceKey: 'selenite' as SourceKey,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function mapVelara(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? data as any[] : []
  return games
    .filter((g) => g?.title && g.title !== '!!DMCA' && !g.title.includes('[!]'))
    .map((g) => {
      let url = g.location ?? ''
      if (url && !url.startsWith('http')) url = `${SOURCES.velara.assets}/${url.replace(/^\//, '')}`
      return {
        id: g.title, name: g.title,
        coverUrl: coverProxy(`${SOURCES.velara.assets}/${g.image ?? ''}`),
        gameUrl: url,
        isExternal: !g.location && !!g.grdmca,
        featured: false, sourceKey: 'velara' as SourceKey,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function mapEdurocks(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? data as any[] : []
  return games
    .filter((g) => g?.name && g?.url)
    .map((g) => ({
      id: g.id ?? g.legacyId ?? g.name,
      name: g.name,
      coverUrl: g.img ? coverProxy(`${SOURCES.edurocks.assets}${g.img.startsWith('/') ? '' : '/'}${g.img}`) : '',
      gameUrl: g.url.startsWith('http') ? g.url : `${SOURCES.edurocks.assets}${g.url.startsWith('/') ? '' : '/'}${g.url}`,
      isExternal: false, featured: false, sourceKey: 'edurocks' as SourceKey,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function mapGnMath(data: unknown): GameEntry[] {
  const zones = Array.isArray(data) ? data as any[] : []
  return zones
    .filter((z) => z?.name && !z.name.includes('[!]'))
    .map((z) => {
      const cover = z.cover
        ? (z.cover.startsWith('http') ? z.cover : `${SOURCES['gn-math'].covers}/${z.cover}`)
        : ''
      const isExternal = typeof z.url === 'string' && z.url.startsWith('http')
      const gameUrl = isExternal
        ? z.url
        : `${SOURCES['gn-math'].html}/${z.url}`
      return {
        id: z.id, name: z.name, author: z.author,
        coverUrl: cover ? coverProxy(cover) : '',
        gameUrl, isExternal,
        featured: z.featured ?? false, sourceKey: 'gn-math' as SourceKey,
      }
    })
    .sort((a, b) => a.featured === b.featured ? a.name.localeCompare(b.name) : a.featured ? -1 : 1)
}

function mapTruffled(data: unknown): GameEntry[] {
  const wrapper = data as { games?: any[] }
  const games = Array.isArray(wrapper?.games) ? wrapper.games : []
  const base = SOURCES.truffled.base
  return games
    .filter((g) => g?.name && g?.url)
    .map((g) => {
      const url = g.url.startsWith('http') ? g.url : `${base}/${g.url.replace(/^\//, '')}`
      const thumb = g.thumbnail
        ? (g.thumbnail.startsWith('http') ? g.thumbnail : `${base}/${g.thumbnail.replace(/^\//, '')}`)
        : ''
      return {
        id: g.name, name: g.name,
        coverUrl: thumb ? coverProxy(thumb) : '',
        gameUrl: url, isExternal: false, featured: false, sourceKey: 'truffled' as SourceKey,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

const cache: Partial<Record<SourceKey, GameEntry[]>> = {}
const inFlight: Partial<Record<SourceKey, Promise<GameEntry[]>>> = {}

export function getActiveSource(): SourceKey {
  const s = localStorage.getItem('nero_source') ?? 'selenite'
  return (['selenite','gn-math','velara','edurocks','truffled'].includes(s) ? s : 'selenite') as SourceKey
}

export function setActiveSource(s: SourceKey) {
  localStorage.setItem('nero_source', s)
  delete cache[s]
  delete inFlight[s]
}

export function fetchGames(source?: SourceKey): Promise<GameEntry[]> {
  const src = source ?? getActiveSource()
  if (cache[src]) return Promise.resolve(cache[src]!)
  if (inFlight[src]) return inFlight[src]!

  const ok = (r: Response) => r.ok ? r.json() : Promise.reject(r.statusText)

  const p: Promise<GameEntry[]> = (() => {
    switch (src) {
      case 'selenite': return fetch(SOURCES.selenite.games).then(ok).then(mapSelenite)
      case 'velara':   return fetch(SOURCES.velara.games).then(ok).then(mapVelara)
      case 'edurocks': return fetch(SOURCES.edurocks.games).then(ok).then(mapEdurocks)
      case 'gn-math':  return fetch(SOURCES['gn-math'].zones).then(ok).then(mapGnMath)
      case 'truffled': return fetch(SOURCES.truffled.games).then(ok).then(mapTruffled)
    }
  })().then((games) => {
    games.forEach((g) => {
      g._nameLc = g.name.toLowerCase()
      g._authorLc = (g.author ?? '').toLowerCase()
    })
    cache[src] = games
    delete inFlight[src]
    return games
  })

  inFlight[src] = p
  return p
}
