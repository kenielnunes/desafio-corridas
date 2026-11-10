import { type FormEvent, useRef, useState } from 'react';
import { api, newIdempotencyKey, type Ride } from './api';
import { ErrorMessage, StatusBadge } from './components';
import { usePolling } from './usePolling';

export function PassengerScreen({ token }: { token: string }) {
  const rides = usePolling(() => api.list(token), 3_000, token);
  const [selectedId, setSelectedId] = useState<string>();

  return (
    <>
      <NewRide
        token={token}
        onCreated={(ride) => {
          rides.reload();
          setSelectedId(ride.id);
        }}
      />
      {selectedId && <Tracking key={selectedId} token={token} id={selectedId} />}
      <section className="card">
        <h2>Minhas corridas</h2>
        <ErrorMessage message={rides.error} />
        <ul>
          {rides.data?.map((ride) => (
            <li key={ride.id} data-testid="passenger-ride">
              <button className="link" onClick={() => setSelectedId(ride.id)}>
                {ride.origin} → {ride.destination}
              </button>
              <StatusBadge status={ride.status} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function NewRide({ token, onCreated }: { token: string; onCreated: (ride: Ride) => void }) {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  // A chave representa a intenção: reenviar o mesmo pedido depois de um erro de rede reaproveita a
  // chave, e a API devolve a corrida já criada; mudar origem ou destino é outro pedido, com chave nova.
  const lastAttempt = useRef<{ key: string; content: string } | null>(null);

  function keyFor(content: string) {
    if (lastAttempt.current?.content !== content) {
      lastAttempt.current = { key: newIdempotencyKey(), content };
    }
    return lastAttempt.current.key;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const data = { origin: origin.trim(), destination: destination.trim() };
    setSending(true);
    setError(undefined);
    try {
      const ride = await api.create(token, keyFor(`${data.origin}\n${data.destination}`), data);
      lastAttempt.current = null;
      setOrigin('');
      setDestination('');
      onCreated(ride);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Pedir corrida</h2>
      <label>
        Origem
        <input data-testid="origin" value={origin} onChange={(e) => setOrigin(e.target.value)} />
      </label>
      <label>
        Destino
        <input
          data-testid="destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </label>
      <ErrorMessage message={error} testId="request-error" />
      <button
        disabled={sending || !origin.trim() || !destination.trim()}
        data-testid="request-ride"
      >
        Solicitar
      </button>
    </form>
  );
}

function Tracking({ token, id }: { token: string; id: string }) {
  const reading = usePolling(() => api.get(token, id), 2_000, `${token}:${id}`);
  const ride = reading.data?.ride;

  return (
    <section className="card highlight" data-testid="tracking">
      <h2>Acompanhando</h2>
      <ErrorMessage message={reading.error} />
      {ride && (
        <>
          <p>
            {ride.origin} → {ride.destination}
          </p>
          <p>
            <StatusBadge status={ride.status} /> versão {ride.version}
          </p>
          <p>Motorista: {ride.driverId ?? 'aguardando'}</p>
          <p className="hint">
            Última leitura: {reading.data?.cache === 'HIT' ? 'cache (Redis)' : 'banco (MySQL)'}
          </p>
        </>
      )}
    </section>
  );
}
