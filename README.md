# corridas

Serviço do desafio técnico da IPLANRIO: o passageiro solicita uma corrida, o motorista aceita, e o status é acompanhado quase em tempo real.

```
[UI React] ──HTTP+JWT──▶ [API NestJS] ──▶ MySQL (corridas: fonte da verdade)
                              │
                              └─ publica evento ──▶ [RabbitMQ] ──▶ [Worker Node] ──▶ Redis (cache de status)
                                                                                 └─▶ MongoDB (histórico)
```

## Escopo e priorização

- **Parte 1, fundação:** completa.
- **Parte 2, operar:** completa. Logs em JSON com `correlation_id` e `trace_id`, métricas na API e no worker, trace da API até o worker no Jaeger, os dois alertas (`alerts.yml` e PrometheusRule) e teste de carga com relatório.
- **Parte 3, Kubernetes:** não fiz. O [LIMITES.md](LIMITES.md) descreve como eu faria, com os valores de CPU e memória medidos no teste de carga.

Por que essa ordem: o enunciado diz que uma Parte 1 sólida vale mais do que as três partes superficiais, e que a Parte 2 tem peso alto. RabbitMQ, Prometheus e OpenTelemetry eram ferramentas que eu precisava aprender a ponto de explicar cada linha; no tempo sugerido, o Kubernetes ficaria superficial.

## Como subir

Pré-requisito: Docker com Compose.

```bash
docker compose up -d --build --wait
```

Se a porta 3000 ou a 8080 já estiver ocupada na sua máquina, escolha outra (`API_PORT`, `UI_PORT`) e use-a nos comandos abaixo:

```bash
API_PORT=3100 docker compose up -d --build --wait
```

| Serviço           | Endereço               | Observação                                                    |
| ----------------- | ---------------------- | ------------------------------------------------------------- |
| Interface         | http://localhost:8080  | login colando um token de teste                               |
| API               | http://localhost:3000  | `/health/live`, `/health/ready` e `/metrics` sem token        |
| Worker            | http://localhost:9464  | `/metrics`, `/health/live` e `/health/ready`                  |
| RabbitMQ (painel) | http://localhost:15672 | usuário `corridas`, senha `corridas_dev` (só desenvolvimento) |
| Prometheus        | http://localhost:9090  | alertas em http://localhost:9090/alerts                       |
| Jaeger            | http://localhost:16686 | traces da API e do worker                                     |

Para os testes de integração e para inspeção local, o MongoDB, o Redis e a porta AMQP do RabbitMQ também ficam acessíveis só em `127.0.0.1` (portas 27017, 6379 e 5672, que podem ser trocadas com `MONGO_PORT`, `REDIS_PORT` e `RABBITMQ_PORT`; a do worker, com `WORKER_PORT`).

Para derrubar tudo e apagar os dados:

```bash
docker compose down -v
```

## Usando a interface

1. Abra http://localhost:8080 e cole o conteúdo de `auth-dev/tokens/passageiro-1.jwt` (por exemplo, `cat auth-dev/tokens/passageiro-1.jwt`).
2. Peça uma corrida. O painel "Acompanhando" consulta a corrida a cada 2 segundos e mostra se a última leitura veio do cache (Redis) ou do banco (MySQL).
3. Numa janela anônima, entre com `auth-dev/tokens/motorista-1.jwt`, aceite a corrida em "Corridas disponíveis" e depois inicie e finalize em "Minhas corridas em andamento".
4. Na janela do passageiro, o status muda sozinho: Solicitada, Aceita, Em andamento, Finalizada.

## Tokens de teste

A pasta `auth-dev/tokens/` tem tokens JWT **de teste**, assinados por uma chave privada que foi descartada. A API só conhece a chave pública (`auth-dev/public-key.pem`).

| Arquivo                                 | Para quê                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| `passageiro-1.jwt` a `passageiro-7.jwt` | passageiros (o 6 e o 7 são dos testes do worker e do e2e) |
| `motorista-1.jwt` e `motorista-2.jwt`   | motoristas                                                |
| `expired.jwt`                           | demonstrar o 401 de token vencido                         |
| `other-key.jwt`                         | demonstrar o 401 de assinatura inválida                   |

Os tokens valem até novembro de 2027. Para gerar um par de chaves e tokens novos:

```bash
docker run --rm -v "$PWD/auth-dev:/auth-dev" node:24-alpine node /auth-dev/generate-tokens.mjs
docker compose restart api
```

## Roteiro de validação da API

```bash
API=http://localhost:3000
P1=$(cat auth-dev/tokens/passageiro-1.jwt)
P2=$(cat auth-dev/tokens/passageiro-2.jwt)
M1=$(cat auth-dev/tokens/motorista-1.jwt)
M2=$(cat auth-dev/tokens/motorista-2.jwt)
nova_chave() { uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid; }
```

**401: sem token, token vencido e token assinado por outra chave**

```bash
curl -i $API/corridas
curl -i -H "Authorization: Bearer $(cat auth-dev/tokens/expired.jwt)" $API/corridas
curl -i -H "Authorization: Bearer $(cat auth-dev/tokens/other-key.jwt)" $API/corridas
```

**201 e idempotência: o mesmo POST com a mesma `Idempotency-Key` devolve a mesma corrida**

```bash
CHAVE=$(nova_chave)
criar() { curl -s -i -X POST $API/corridas -H "Authorization: Bearer $P1" -H "Idempotency-Key: $CHAVE" \
  -H 'Content-Type: application/json' -d '{"origin":"Centro","destination":"Barra da Tijuca"}'; }
criar
criar   # mesmo id e o header Idempotent-Replayed: true
ID=$(criar | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
```

**403: perfil errado e corrida de outra pessoa**

```bash
curl -i -X PATCH $API/corridas/$ID/status -H "Authorization: Bearer $P1" \
  -H 'Content-Type: application/json' -d '{"status":"accepted"}'                 # passageiro não muda status
curl -i -H "Authorization: Bearer $P2" $API/corridas/$ID                     # corrida de outro passageiro
curl -i -X POST $API/corridas -H "Authorization: Bearer $M1" -H "Idempotency-Key: $(nova_chave)" \
  -H 'Content-Type: application/json' -d '{"origin":"Centro","destination":"Barra"}'   # motorista não cria
```

**200 e 409: dois motoristas aceitando a mesma corrida ao mesmo tempo**

```bash
aceitar() { curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $API/corridas/$ID/status \
  -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d '{"status":"accepted"}'; }
aceitar "$M1" & aceitar "$M2"; wait   # um 200 e um 409
```

**Listas: o motorista vê as dele por padrão e as disponíveis com `?available=true`**

```bash
curl -s -H "Authorization: Bearer $P1" $API/corridas                      # corridas do passageiro
curl -s -H "Authorization: Bearer $M1" "$API/corridas?available=true"    # solicitadas, para aceitar
curl -s -H "Authorization: Bearer $M1" $API/corridas                      # corridas do motorista
```

**429: a 11ª requisição de criação no mesmo minuto**

```bash
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code} " -X POST $API/corridas -H "Authorization: Bearer $P2" \
    -H "Idempotency-Key: $(nova_chave)" -H 'Content-Type: application/json' \
    -d '{"origin":"Centro","destination":"Barra"}'
done; echo
```

## Roteiro de validação do fluxo assíncrono

Cada criação e cada mudança de status publica um evento no RabbitMQ. O worker consome, grava o histórico no MongoDB e atualiza o cache no Redis. Use as variáveis do roteiro anterior e uma corrida recém-criada:

```bash
ID=$(curl -s -X POST $API/corridas -H "Authorization: Bearer $P1" -H "Idempotency-Key: $(nova_chave)" \
  -H 'Content-Type: application/json' -d '{"origin":"Centro","destination":"Urca"}' | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
```

**Histórico no MongoDB e cache no Redis**

```bash
docker compose exec mongo mongosh --quiet -u corridas -p corridas_dev --authenticationDatabase admin corridas \
  --eval "db.ride_history.find({ rideId: '$ID' }).toArray()"
curl -s -D - -o /dev/null -H "Authorization: Bearer $P1" $API/corridas/$ID | grep -i x-cache   # HIT: veio do Redis
docker compose exec redis redis-cli GET ride:$ID
docker compose exec redis redis-cli TTL ride:$ID      # segundos até expirar (começa em 300)
docker compose exec redis redis-cli DEL ride:$ID      # a próxima leitura é MISS e vem do MySQL
```

**Mensagem duplicada: a mesma mensagem entregue duas vezes gera um registro só**

```bash
EVENTO_ID=$(nova_chave)
AGORA=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
EVENTO="{\"eventId\":\"$EVENTO_ID\",\"type\":\"corrida.criada\",\"occurredAt\":\"$AGORA\",\"ride\":{\"id\":\"$(nova_chave)\",\"passengerId\":\"demo\",\"driverId\":null,\"origin\":\"Centro\",\"destination\":\"Barra\",\"status\":\"requested\",\"version\":1,\"createdAt\":\"$AGORA\",\"updatedAt\":\"$AGORA\"}}"
publicar() { docker compose exec rabbitmq rabbitmqadmin --username corridas --password corridas_dev \
  publish message --exchange rides --routing-key corrida.criada --payload "$1"; }
publicar "$EVENTO"; publicar "$EVENTO"
docker compose logs worker | grep "$EVENTO_ID"     # result "processed" na primeira e "duplicate" na segunda
```

**Mensagem inválida vai para a fila de erros (DLQ)**

```bash
publicar 'isto não é um evento'
sleep 5   # as contagens do rabbitmqctl são atualizadas de tempos em tempos
docker compose exec rabbitmq rabbitmqctl list_queues name messages | grep rides   # rides.worker.dlq cresce
```

**Falha temporária: com o MongoDB fora, o RabbitMQ reentrega com espera crescente**

```bash
docker compose stop mongo
curl -s -X POST $API/corridas -H "Authorization: Bearer $P1" -H "Idempotency-Key: $(nova_chave)" \
  -H 'Content-Type: application/json' -d '{"origin":"Lapa","destination":"Leme"}'
docker compose logs -f worker      # "falhou; o RabbitMQ vai reentregar", com intervalos crescentes
docker compose start mongo         # em outro terminal: o próximo intervalo termina em "processado"
```

## Observabilidade

**Logs em JSON com correlation id, da API até o histórico**

Cada requisição ganha um id de correlação: o `X-Correlation-Id` enviado pelo cliente, se for um UUID, ou um novo. Ele volta no header da resposta, aparece no log da requisição, vai para o worker na propriedade `correlationId` da mensagem AMQP e fica gravado no histórico do MongoDB.

```bash
CID=$(nova_chave)
curl -s -X POST $API/corridas -H "Authorization: Bearer $P1" -H "Idempotency-Key: $(nova_chave)" \
  -H "X-Correlation-Id: $CID" -H 'Content-Type: application/json' -d '{"origin":"Gávea","destination":"Leblon"}'
sleep 1   # dá tempo de o worker processar o evento
docker compose logs api worker --no-log-prefix | grep "$CID"   # a requisição na API e o evento no worker
docker compose exec mongo mongosh --quiet -u corridas -p corridas_dev --authenticationDatabase admin corridas \
  --eval "db.ride_history.find({ correlationId: '$CID' }, { type: 1, status: 1, correlationId: 1 }).toArray()"
```

**Métricas**

| Onde                               | Métricas                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API, `/metrics`                    | `http_requests_total` e `http_request_duration_seconds` (por método, rota e status), `cache_reads_total` (hit, miss, error), `events_published_total` (ok, failed)           |
| Worker, `/metrics`                 | `worker_messages_total` (processed, duplicate, invalid, failed), `worker_processing_duration_seconds`, `worker_event_lag_seconds` (da mudança na API até o worker processar) |
| RabbitMQ, coletado pelo Prometheus | `rabbitmq_detailed_queue_messages_ready` (mensagens esperando em cada fila)                                                                                                  |

Consultas para colar em http://localhost:9090/query:

- taxa de requisições: `sum by (route, status_code) (rate(http_requests_total[1m]))`
- latência p95 da API: `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))`
- proporção de erros 5xx: `sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` (sem resultado enquanto não houver nenhum 5xx nos últimos 5 minutos)
- tamanho da fila: `rabbitmq_detailed_queue_messages_ready{queue="rides.worker"}`
- atraso p95 da fila: `histogram_quantile(0.95, sum by (le) (rate(worker_event_lag_seconds_bucket[5m])))`

**Alertas**

As regras ficam em `observability/alerts.yml`, carregado pelo Prometheus do compose, e em `observability/alerts-prometheusrule.yaml`, as mesmas regras no formato PrometheusRule. O CI confere que os dois arquivos têm os mesmos groups. Por que esses dois alertas e esses limiares: [DECISIONS.md](DECISIONS.md), entrada 7.

Para ver o alerta da fila mudar de estado em http://localhost:9090/alerts:

```bash
docker compose stop worker
for i in $(seq 120); do
  curl -s -o /dev/null -u corridas:corridas_dev -H 'Content-Type: application/json' \
    -d '{"properties":{},"routing_key":"corrida.criada","payload":"teste do alerta","payload_encoding":"string"}' \
    http://localhost:15672/api/exchanges/%2F/rides/publish
done
```

Em uns 20 s, o `RidesWorkerQueueBacklog` fica "pending" em http://localhost:9090/alerts, e depois de 5 minutos acima de 100 mensagens, "firing". Para voltar ao normal:

```bash
docker compose start worker                                       # a fila esvazia e o alerta volta a "inactive"
docker compose exec rabbitmq rabbitmqctl purge_queue rides.worker.dlq   # as mensagens de teste eram inválidas e foram para a DLQ
```

**Trace distribuído (OpenTelemetry e Jaeger)**

A API e o worker enviam traces para o Jaeger por OTLP. O contexto viaja no header `traceparent` da mensagem do RabbitMQ, então uma corrida aparece num trace só: na API, o `POST /corridas`, as consultas do Prisma e a publicação; no worker, o consumo, a gravação no MongoDB e a atualização do Redis. Os logs das duas pontas trazem o mesmo `trace_id`. Sem a variável `OTEL_EXPORTER_OTLP_ENDPOINT`, a instrumentação nem é carregada.

```bash
CID=$(nova_chave)
curl -s -X POST $API/corridas -H "Authorization: Bearer $P1" -H "Idempotency-Key: $(nova_chave)" \
  -H "X-Correlation-Id: $CID" -H 'Content-Type: application/json' -d '{"origin":"Lapa","destination":"Glória"}'
sleep 1   # dá tempo de o worker processar o evento
docker compose logs api worker --no-log-prefix | grep "$CID" | grep -o '"trace_id":"[^"]*"'   # o mesmo id nas duas linhas
```

Abra http://localhost:16686, cole esse id em "Search by Trace ID" (ou escolha o serviço `corridas-api`) e veja os spans da API e do worker na mesma linha do tempo.

## Teste de carga

O script fica em `loadtest/rides.js`, e o relatório com o cenário, os números e as conclusões, em [loadtest/REPORT.md](loadtest/REPORT.md). Com a stack de pé:

```bash
RATE_LIMIT_REQUESTS_PER_MINUTE=1000000 RATE_LIMIT_CREATES_PER_MINUTE=1000000 docker compose up -d --wait api
docker compose run --rm k6                        # 20 corridas por segundo; RIDES_PER_SECOND=100 para saturar
docker compose up -d --wait api                   # volta ao rate limit normal
```

O rate limit sobe durante o teste porque o objetivo é medir a capacidade; com o limite normal, os 7 passageiros de teste fariam no máximo 70 corridas por minuto.

## Testes

Pré-requisito: Node 24 e pnpm (`corepack enable`).

```bash
pnpm install
pnpm test                                       # unitários (regras da API e decisões do worker)
pnpm --filter @corridas/api test:api            # testes de API, com o compose de pé
pnpm --filter @corridas/worker test:integration  # worker: duplicata, DLQ, rajada fora de ordem, fluxo completo
pnpm e2e                                        # interface com Playwright, no Google Chrome instalado
pnpm e2e:headed                                 # o mesmo, abrindo o navegador na tela
```

Sem o Google Chrome instalado, use o Chromium do Playwright: `pnpm --filter @corridas/e2e exec playwright install chromium` e rode com `CI=1 pnpm e2e`.

Se a API estiver em outra porta, passe `API_URL=http://localhost:3100` para as duas suítes de integração. A suíte respeita o rate limit de 10 requisições de criação por minuto por passageiro; rodando mais de 3 vezes no mesmo minuto, ela começa a receber 429.

## Documentos

- [DECISIONS.md](DECISIONS.md): decisões, alternativas e trade-offs.
- [LIMITES.md](LIMITES.md): o que ficou de fora e os riscos conhecidos.
- [DIARIO.md](DIARIO.md): diário de bordo do desenvolvimento.
- [loadtest/REPORT.md](loadtest/REPORT.md): relatório do teste de carga.
