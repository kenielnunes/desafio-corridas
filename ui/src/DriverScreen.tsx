import { type MouseEvent, useState } from 'react';
import { api, type RideStatus } from './api';
import { ErrorMessage, StatusBadge } from './components';
import { usePolling } from './usePolling';

type Action = Exclude<RideStatus, 'requested'>;

export function DriverScreen({ token }: { token: string }) {
  const mine = usePolling(() => api.list(token, { active: true }), 3_000, `${token}:mine`);
  const available = usePolling(
    () => api.list(token, { available: true }),
    3_000,
    `${token}:available`,
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function act(event: MouseEvent, id: string, status: Action) {
    // O segundo clique de um duplo clique é ignorado: a lista se atualiza entre os dois cliques,
    // e ele cairia no botão de outra corrida que subiu para o mesmo lugar.
    if (event.detail > 1 || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.updateStatus(token, id, status);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      mine.reload();
      available.reload();
    }
  }

  const button = (id: string, status: Action, label: string) => (
    <button disabled={busy} onClick={(event) => act(event, id, status)}>
      {label}
    </button>
  );

  return (
    <>
      <ErrorMessage message={error} testId="driver-error" sticky />
      <section className="card">
        <h2>Minhas corridas em andamento</h2>
        <ErrorMessage message={mine.error} />
        {mine.data?.length === 0 && <p className="hint">Nenhuma corrida em andamento.</p>}
        <ul>
          {mine.data?.map((ride) => (
            <li key={ride.id} data-testid="driver-ride">
              <span>
                {ride.origin} → {ride.destination}
              </span>
              <StatusBadge status={ride.status} />
              {ride.status === 'accepted' && button(ride.id, 'in_progress', 'Iniciar')}
              {ride.status === 'in_progress' && button(ride.id, 'finished', 'Finalizar')}
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
              {button(ride.id, 'accepted', 'Aceitar')}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
