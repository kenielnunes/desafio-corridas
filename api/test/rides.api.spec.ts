import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:3000';

const token = (name: string) =>
  readFileSync(new URL(`../../auth-dev/tokens/${name}.jwt`, import.meta.url), 'utf8').trim();

type Options = {
  token?: string;
  authorization?: string;
  body?: unknown;
  key?: string;
  headers?: Record<string, string>;
};

async function call(method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.authorization) headers.authorization = options.authorization;
  if (options.key) headers['idempotency-key'] = options.key;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

const createRide = (person: string, key: string = randomUUID()) =>
  call('POST', '/corridas', {
    token: token(person),
    key,
    body: { origin: 'Centro', destination: 'Barra da Tijuca' },
  });

async function newRide(person: string) {
  const response = await createRide(person);
  expect(response.status, `criar corrida para o teste (429 = rate limit de ${person})`).toBe(201);
  return response.body as { id: string };
}

const updateStatus = (person: string, id: string, status: string) =>
  call('PATCH', `/corridas/${id}/status`, { token: token(person), body: { status } });

describe('autenticação: 401', () => {
  it('sem token', async () => {
    const response = await call('GET', '/corridas');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('token adulterado: trocar o perfil no conteúdo invalida a assinatura', async () => {
    const [header, , signature] = token('passageiro-1').split('.');
    const forgedClaims = Buffer.from(
      JSON.stringify({
        sub: 'passageiro-1',
        role: 'motorista',
        iss: 'corridas-auth-dev',
        aud: 'corridas-api',
        exp: 9_999_999_999,
      }),
    ).toString('base64url');
    const response = await call('GET', '/corridas', {
      token: `${header}.${forgedClaims}.${signature}`,
    });
    expect(response.status).toBe(401);
  });

  it('token expirado', async () => {
    expect((await call('GET', '/corridas', { token: token('expired') })).status).toBe(401);
  });

  it('token assinado por outra chave', async () => {
    expect((await call('GET', '/corridas', { token: token('other-key') })).status).toBe(401);
  });

  it('texto sobrando depois do token', async () => {
    const authorization = `Bearer ${token('passageiro-1')} sobra`;
    expect((await call('GET', '/corridas', { authorization })).status).toBe(401);
  });

  it('o nome do esquema não diferencia maiúsculas (RFC 9110)', async () => {
    const authorization = `bearer ${token('passageiro-1')}`;
    expect((await call('GET', '/corridas', { authorization })).status).toBe(200);
  });
});

describe('autorização: 403', () => {
  let id: string;
  beforeAll(async () => {
    id = (await newRide('passageiro-4')).id;
  });

  it('motorista não cria corrida', async () => {
    expect((await createRide('motorista-1')).status).toBe(403);
  });

  it('passageiro não muda status', async () => {
    expect((await updateStatus('passageiro-4', id, 'accepted')).status).toBe(403);
  });

  it('passageiro não lê corrida de outro passageiro', async () => {
    const response = await call('GET', `/corridas/${id}`, { token: token('passageiro-2') });
    expect(response.status).toBe(403);
  });

  it('motorista não inicia corrida aceita por outro motorista', async () => {
    expect((await updateStatus('motorista-1', id, 'accepted')).status).toBe(200);
    expect((await updateStatus('motorista-2', id, 'in_progress')).status).toBe(403);
  });
});

describe('listagem por perfil', () => {
  let available: string;
  let acceptedByOther: string;
  beforeAll(async () => {
    available = (await newRide('passageiro-4')).id;
    acceptedByOther = (await newRide('passageiro-4')).id;
    await updateStatus('motorista-1', acceptedByOther, 'accepted');
  });

  const ids = (rides: { id: string }[]) => rides.map((ride) => ride.id);

  it('passageiro vê só as próprias corridas', async () => {
    const owner = await call('GET', '/corridas', { token: token('passageiro-4') });
    expect(ids(owner.body)).toEqual(expect.arrayContaining([available, acceptedByOther]));
    const other = await call('GET', '/corridas', { token: token('passageiro-2') });
    expect(ids(other.body)).not.toContain(available);
  });

  it('motorista vê as corridas disponíveis com ?available=true', async () => {
    const { body } = await call('GET', '/corridas?available=true', {
      token: token('motorista-2'),
    });
    expect(ids(body)).toContain(available);
    expect(body.every((ride: { status: string }) => ride.status === 'requested')).toBe(true);
  });

  it('sem filtro, o motorista vê só as corridas dele', async () => {
    const { body } = await call('GET', '/corridas', { token: token('motorista-2') });
    expect(ids(body)).not.toContain(acceptedByOther);
    expect(body.every((ride: { driverId: string }) => ride.driverId === 'motorista-2')).toBe(true);
  });

  it('motorista não lê corrida aceita por outro motorista', async () => {
    const response = await call('GET', `/corridas/${acceptedByOther}`, {
      token: token('motorista-2'),
    });
    expect(response.status).toBe(403);
  });
});

describe('fluxo feliz', () => {
  it('cria, aceita, inicia e finaliza, com a versão subindo a cada mudança', async () => {
    const created = await createRide('passageiro-1');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      passengerId: 'passageiro-1',
      status: 'requested',
      version: 1,
    });
    const id = created.body.id;

    const accepted = await updateStatus('motorista-1', id, 'accepted');
    expect(accepted.body).toMatchObject({
      status: 'accepted',
      driverId: 'motorista-1',
      version: 2,
    });
    expect((await updateStatus('motorista-1', id, 'in_progress')).body.version).toBe(3);
    expect((await updateStatus('motorista-1', id, 'finished')).body.status).toBe('finished');

    const read = await call('GET', `/corridas/${id}`, { token: token('passageiro-1') });
    expect(read.body).toMatchObject({ status: 'finished', version: 4 });

    const list = await call('GET', '/corridas', { token: token('passageiro-1') });
    expect(list.body.map((ride: { id: string }) => ride.id)).toContain(id);
  });

  it('transição inválida responde 409', async () => {
    const { id } = await newRide('passageiro-1');
    expect((await updateStatus('motorista-1', id, 'finished')).status).toBe(409);
  });
});

describe('idempotência', () => {
  it('a mesma Idempotency-Key devolve a corrida original', async () => {
    const key = randomUUID();
    const first = await createRide('passageiro-2', key);
    const second = await createRide('passageiro-2', key);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
  });

  it('requisições simultâneas com a mesma chave criam uma corrida só', async () => {
    const key = randomUUID();
    const responses = await Promise.all([1, 2, 3].map(() => createRide('passageiro-3', key)));
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
  });

  it('sem a chave responde 400', async () => {
    const response = await call('POST', '/corridas', {
      token: token('passageiro-2'),
      body: { origin: 'Centro', destination: 'Barra da Tijuca' },
    });
    expect(response.status).toBe(400);
  });
});

describe('concorrência', () => {
  it('dois motoristas aceitando juntos: um consegue, o outro recebe 409', async () => {
    const { id } = await newRide('passageiro-1');
    const responses = await Promise.all([
      updateStatus('motorista-1', id, 'accepted'),
      updateStatus('motorista-2', id, 'accepted'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('rate limit', () => {
  it('passando do limite de criações por minuto a API responde 429 com Retry-After', async () => {
    let blocked: Awaited<ReturnType<typeof createRide>> | undefined;
    for (let attempt = 0; attempt < 11 && !blocked; attempt++) {
      const response = await createRide('passageiro-5');
      if (response.status === 429) blocked = response;
    }
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('cache de leitura', () => {
  it('depois de mudar o status, a leitura mostra o status novo e a seguinte vem do cache', async () => {
    const { id } = await newRide('passageiro-1');
    await updateStatus('motorista-1', id, 'accepted');

    const read = () => call('GET', `/corridas/${id}`, { token: token('passageiro-1') });
    expect((await read()).body).toMatchObject({ status: 'accepted', version: 2 });
    const second = await read();
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(second.body).toMatchObject({ status: 'accepted', version: 2 });
  });
});

describe('observabilidade', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('devolve o X-Correlation-Id recebido e gera outro quando o recebido não é UUID', async () => {
    const sent = randomUUID();
    const kept = await call('GET', '/corridas', {
      token: token('passageiro-1'),
      headers: { 'x-correlation-id': sent },
    });
    expect(kept.headers.get('x-correlation-id')).toBe(sent);

    const replaced = await call('GET', '/corridas', {
      token: token('passageiro-1'),
      headers: { 'x-correlation-id': 'texto qualquer' },
    });
    expect(replaced.headers.get('x-correlation-id')).toMatch(UUID);
  });
});
