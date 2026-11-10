export type RideStatus = 'requested' | 'accepted' | 'in_progress' | 'finished';

export type Ride = {
  id: string;
  passengerId: string;
  driverId: string | null;
  origin: string;
  destination: string;
  status: RideStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => undefined;

export function handleUnauthorized(callback: () => void) {
  onUnauthorized = callback;
}

// crypto.randomUUID só existe em contexto seguro (HTTPS ou localhost); getRandomValues existe sempre.
export function newIdempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function request<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Tente de novo.');
  }
  const body = await response.json().catch(() => null);
  if (response.status === 401) onUnauthorized();
  if (!response.ok) throw new ApiError(response.status, errorMessage(response.status, body));
  return { body: body as T, headers: response.headers };
}

function errorMessage(status: number, body: unknown) {
  if (status === 401) return 'Sessão inválida ou expirada. Entre de novo.';
  if (status === 429) return 'Muitas tentativas seguidas. Aguarde alguns segundos.';
  const message = (body as { message?: string | string[] } | null)?.message;
  const text = Array.isArray(message) ? message.join('; ') : message;
  return text ? `${text} (${status})` : `Erro inesperado (${status}).`;
}

export const api = {
  list: async (token: string, filter: { available?: boolean; active?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (filter.available) query.set('available', 'true');
    if (filter.active) query.set('active', 'true');
    const suffix = query.size > 0 ? `?${query}` : '';
    return (await request<Ride[]>(token, `/corridas${suffix}`)).body;
  },

  get: async (token: string, id: string) => {
    const { body, headers } = await request<Ride>(token, `/corridas/${id}`);
    return { ride: body, cache: headers.get('x-cache') };
  },

  create: async (token: string, key: string, data: { origin: string; destination: string }) =>
    (
      await request<Ride>(token, '/corridas', {
        method: 'POST',
        body: data,
        headers: { 'idempotency-key': key },
      })
    ).body,

  updateStatus: async (token: string, id: string, status: Exclude<RideStatus, 'requested'>) =>
    (await request<Ride>(token, `/corridas/${id}/status`, { method: 'PATCH', body: { status } }))
      .body,
};
