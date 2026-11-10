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

async function request<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, errorMessage(response.status, body));
  return { body: body as T, headers: response.headers };
}

function errorMessage(status: number, body: unknown) {
  const message = (body as { message?: string | string[] } | null)?.message;
  return `${status}: ${Array.isArray(message) ? message.join('; ') : (message ?? 'erro inesperado')}`;
}

export const api = {
  list: async (token: string, available = false) =>
    (await request<Ride[]>(token, available ? '/corridas?available=true' : '/corridas')).body,

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
