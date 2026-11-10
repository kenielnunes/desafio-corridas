import { useState } from 'react';
import { api, type RideStatus } from './api';
import { ErrorMessage, StatusBadge } from './components';
import { usePolling } from './usePolling';

export function DriverScreen({ token }: { token: string }) {
  const available = usePolling(() => api.list(token, true), 3_000, `${token}:available`);
  const mine = usePolling(() => api.list(token), 3_000, `${token}:mine`);
  const [error, setError] = useState<string>();

  async function act(id: string, status: Exclude<RideStatus, 'requested'>) {
    setError(undefined);
    try {
      await api.updateStatus(token, id, status);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      available.reload();
      mine.reload();
    }
  }

  return (
    <>
      <ErrorMessage message={error} testId="driver-error" />
      <section className="card">
        <h2>Minhas corridas</h2>
        <ErrorMessage message={mine.error} />
        <ul>
          {mine.data?.map((ride) => (
            <li key={ride.id} data-testid="driver-ride">
              <span>
                {ride.origin} → {ride.destination}
              </span>
              <StatusBadge status={ride.status} />
              {ride.status === 'accepted' && (
                <button onClick={() => act(ride.id, 'in_progress')}>Iniciar</button>
              )}
              {ride.status === 'in_progress' && (
                <button onClick={() => act(ride.id, 'finished')}>Finalizar</button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Corridas disponíveis</h2>
        <ErrorMessage message={available.error} />
        {available.data?.length === 0 && <p className="hint">Nenhuma corrida esperando.</p>}
        <ul>
          {available.data?.map((ride) => (
            <li key={ride.id} data-testid="available-ride">
              <span>
                {ride.origin} → {ride.destination}
              </span>
              <button onClick={() => act(ride.id, 'accepted')}>Aceitar</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
