import { useState } from 'react'
import { login, register, saveSession } from '../lib/auth'
import styles from './AuthModal.module.css'

interface AuthModalProps {
  onClose: () => void
  onSuccess: (username: string) => void
}

export default function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const fn = mode === 'login' ? login : register
      const result = await fn(username.trim(), password)
      saveSession(result)
      onSuccess(result.username)
      onClose()
    } catch (err: any) {
      setError(err.message || 'something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.tabs}>
          <button className={mode === 'login' ? styles.activeTab : styles.tab} onClick={() => setMode('login')}>sign in</button>
          <button className={mode === 'register' ? styles.activeTab : styles.tab} onClick={() => setMode('register')}>register</button>
        </div>
        <form className={styles.form} onSubmit={submit}>
          <input
            className={styles.input}
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
          <input
            className={styles.input}
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 6 : 1}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.submit} disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'sign in' : 'create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
