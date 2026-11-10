import { useEffect, useState } from 'react';
import { handleUnauthorized } from './api';
import { DriverScreen } from './DriverScreen';
import { LoginScreen } from './LoginScreen';
import { PassengerScreen } from './PassengerScreen';
import { clearSession, saveSession, savedSession } from './session';

export function App() {
  const [session, setSession] = useState(savedSession);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (!session) {
      handleUnauthorized(() => undefined);
      return;
    }
    handleUnauthorized(() => {
      clearSession();
      setSession(null);
      setNotice('Sua sessão expirou ou o token não vale mais. Entre de novo.');
    });
  }, [session]);

  if (!session) {
    return (
      <LoginScreen
        notice={notice}
        onLogin={(newSession) => {
          saveSession(newSession);
          setNotice(undefined);
          setSession(newSession);
        }}
      />
    );
  }

  return (
    <main>
      <header className="topbar">
        <strong>Corridas</strong>
        <span data-testid="user">
          {session.user} ({session.role})
        </span>
        <button
          className="link"
          data-testid="logout"
          onClick={() => {
            clearSession();
            setSession(null);
          }}
        >
          Sair
        </button>
      </header>
      {session.role === 'passageiro' ? (
        <PassengerScreen token={session.token} />
      ) : (
        <DriverScreen token={session.token} />
      )}
    </main>
  );
}
