import { type FormEvent, useState } from 'react';
import { api, ApiError } from './api';
import { ErrorMessage } from './components';
import { parseToken, type Session } from './session';

export function LoginScreen({
  onLogin,
  notice,
}: {
  onLogin: (session: Session) => void;
  notice?: string;
}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [loggingIn, setLoggingIn] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    const session = parseToken(token);
    if (!session) {
      setError('Isso não parece um token de passageiro ou de motorista.');
      return;
    }
    setLoggingIn(true);
    setError(undefined);
    try {
      await api.list(session.token);
      onLogin(session);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setError('Token inválido ou expirado.');
      } else {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <main className="narrow">
      <form className="card" onSubmit={login}>
        <h1>Corridas</h1>
        {notice && <p className="hint">{notice}</p>}
        <label>
          Token JWT
          <textarea
            data-testid="token-input"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <p className="hint">
          Tokens de teste em <code>auth-dev/tokens/</code>.
        </p>
        <ErrorMessage message={error} testId="login-error" />
        <button disabled={loggingIn || !token.trim()} data-testid="login-button">
          Entrar
        </button>
      </form>
    </main>
  );
}
