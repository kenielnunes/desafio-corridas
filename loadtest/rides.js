import { check, sleep } from 'k6';
import http from 'k6/http';

const API = __ENV.API_URL || 'http://api:3000';
const RIDES_PER_SECOND = Number(__ENV.RIDES_PER_SECOND || 20);

const PASSENGERS = [1, 2, 3, 4, 5, 6, 7].map((n) => open(`/tokens/passageiro-${n}.jwt`).trim());
const DRIVERS = [1, 2].map((n) => open(`/tokens/motorista-${n}.jwt`).trim());

export const options = {
  scenarios: {
    rides: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: '30s', target: RIDES_PER_SECOND },
        { duration: '2m', target: RIDES_PER_SECOND },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<200'],
    'http_req_duration{kind:write}': ['p(95)<500'],
  },
};

const params = (token, kind, name, extraHeaders = {}) => ({
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...extraHeaders,
  },
  tags: { kind, name },
});

function read(token, id) {
  const response = http.get(`${API}/corridas/${id}`, params(token, 'read', 'GET /corridas/:id'));
  check(response, { 'leitura 200': (r) => r.status === 200 });
}

function updateStatus(token, id, status) {
  const response = http.patch(
    `${API}/corridas/${id}/status`,
    JSON.stringify({ status }),
    params(token, 'write', 'PATCH /corridas/:id/status'),
  );
  check(response, { [`${status} 200`]: (r) => r.status === 200 });
}

// Uma iteração é a vida inteira de uma corrida: o passageiro pede, o motorista aceita, inicia e
// finaliza, e entre um passo e outro o passageiro consulta a corrida, como a tela faz.
export default function () {
  const passenger = PASSENGERS[(__VU + __ITER) % PASSENGERS.length];
  const driver = DRIVERS[__VU % DRIVERS.length];

  const created = http.post(
    `${API}/corridas`,
    JSON.stringify({ origin: 'Teste de carga', destination: 'Centro' }),
    params(passenger, 'write', 'POST /corridas', { 'idempotency-key': crypto.randomUUID() }),
  );
  if (!check(created, { 'criação 201': (r) => r.status === 201 })) return;
  const id = created.json('id');

  read(passenger, id);
  updateStatus(driver, id, 'accepted');
  read(passenger, id);
  sleep(0.5);
  read(passenger, id);
  updateStatus(driver, id, 'in_progress');
  read(passenger, id);
  updateStatus(driver, id, 'finished');
  read(passenger, id);
}
