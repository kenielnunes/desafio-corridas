import { useState } from 'react';
import { DriverScreen } from './DriverScreen';
import { LoginScreen } from './LoginScreen';
import { PassengerScreen } from './PassengerScreen';
import { clearSession, savedSession, saveSession } from './session';

export function App() {
  const [session, setSession] = useState(savedSession);

  if (!session) {
    return (
      <LoginScreen
        onLogin={(newSession) => {
          saveSession(newSession);
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
