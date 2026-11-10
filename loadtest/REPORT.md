# Relatório do teste de carga

## Cenário

- **Script:** `loadtest/rides.js`, com k6 2.3.0 rodando no próprio compose (`docker compose run --rm k6`).
- **Uma iteração é a vida inteira de uma corrida:** o passageiro cria, o motorista aceita, inicia e finaliza, e entre os passos o passageiro consulta a corrida, como a tela faz. São 9 requisições por corrida (1 POST, 3 PATCH e 5 GET) e 4 eventos no RabbitMQ.
- **Carga por taxa de chegada** (executor `ramping-arrival-rate`): 30 s de rampa, 2 min no alvo e 30 s de descida. Rodei com 20, 60 e 100 corridas por segundo.
- **Rate limit elevado durante o teste** (`RATE_LIMIT_*=1000000`). O objetivo é medir a capacidade; o rate limit tem teste próprio. Com o limite normal, os 7 passageiros de teste fariam no máximo 70 corridas por minuto.
- **Ambiente:** tudo no mesmo computador (Ryzen 7 5700X, 16 threads, 16 GB, Docker no WSL2), com o trace do OpenTelemetry ligado para 100% das requisições. Os números valem para comparar as rodadas entre si, não como capacidade de produção.

## O que medi

- **No k6 (cliente):** requisições por segundo, p95 de leitura e de escrita, erros e iterações descartadas (quando as respostas demoram e o k6 não consegue manter a taxa pedida).
- **No Prometheus (servidor):** CPU da API e do worker, tamanho da fila no RabbitMQ, vazão do worker e atraso entre a mudança na API e o processamento do evento.
- **No Jaeger:** onde o tempo de uma requisição lenta é gasto.

## Resultados

| Rodada                     | Pico de req/s | p95 leitura | p95 escrita | Erros | Iterações descartadas | CPU da API | Eventos/s no worker | Fila (máx.) | Atraso p95 do worker |
| -------------------------- | ------------- | ----------- | ----------- | ----- | --------------------- | ---------- | ------------------- | ----------- | -------------------- |
| 20 corridas/s              | 180           | 2,4 ms      | 11,6 ms     | 0%    | 0                     | 0,45       | 80                  | 0           | 10 ms                |
| 60 corridas/s              | 540           | 4,4 ms      | 22,3 ms     | 0%    | 0                     | 0,91       | 240                 | 0           | 15 ms                |
| 100 corridas/s, pool de 10 | 733           | 22,2 ms     | 1,05 s      | 0%    | 3.115                 | 1,12       | 326                 | 0           | 44 ms                |
| 100 corridas/s, pool de 30 | 848           | 48,0 ms     | 711 ms      | 0%    | 942                   | 1,18       | 375                 | 0           | 48 ms                |

CPU em núcleos. Os p95 são do k6; pico de req/s, CPU, fila e atraso são do Prometheus.

Recursos no pico de cada rodada, pelas métricas de processo do prom-client (`process_cpu_seconds_total` e `process_resident_memory_bytes`):

| Rodada                     | CPU da API | Memória da API | CPU do worker | Memória do worker |
| -------------------------- | ---------- | -------------- | ------------- | ----------------- |
| 20 corridas/s              | 0,45       | 417 MB         | 0,13          | 229 MB            |
| 60 corridas/s              | 0,91       | 416 MB         | 0,22          | 236 MB            |
| 100 corridas/s, pool de 10 | 1,12       | 512 MB         | 0,27          | 232 MB            |
| 100 corridas/s, pool de 30 | 1,18       | 539 MB         | 0,24          | 239 MB            |

## O que descobri

1. **Até 60 corridas por segundo, sobra.** São 540 requisições por segundo, nenhum erro, escrita com p95 de 22 ms e fila sempre vazia.
2. **A 100 corridas por segundo, a API satura.** O throughput para perto de 600 requisições por segundo na média, o k6 descarta 3.115 iterações e o p95 da escrita passa de 1 s. Não há erro: as requisições esperam em vez de falhar.
3. **O trace mostrou a causa.** Num PATCH de 1,5 s, 1,43 s ficaram em `prisma:client:start_transaction`, esperando uma conexão livre no pool de 10; as consultas em si levaram de 9 a 46 ms. Cada escrita segura uma conexão durante a transação inteira, com várias idas ao MySQL; com centenas de escritas por segundo, as 10 conexões ficam ocupadas e as transações fazem fila.
4. **Testei a hipótese com 30 conexões** (`DATABASE_POOL_SIZE=30`). O throughput subiu 18%, o p95 da escrita caiu para 711 ms e as iterações descartadas caíram para 942. O limite seguinte é a CPU: a API chegou a 1,18 núcleo, e a leitura subiu de 22 para 48 ms. O código da aplicação num processo Node roda numa thread só.
5. **O worker nunca foi o gargalo.** Processou até 375 eventos por segundo usando um quarto de núcleo, a fila ficou em zero em todas as coletas e o atraso p95 ficou abaixo de 50 ms.
6. **O cache segura as leituras.** A proporção de HIT ficou acima de 73% a 20 corridas por segundo e acima de 93% a 100 corridas por segundo, e as leituras continuaram rápidas mesmo com a escrita saturada.

## O que eu mudaria

- **Escalar a API em réplicas, não em processo maior.** Com o pool ajustado, o limite é a CPU de um processo. Mais réplicas exigem levar o contador do rate limit para o Redis (hoje ele é em memória, ver LIMITES) e dimensionar o pool com réplicas × conexões abaixo do `max_connections` do MySQL (151 por padrão).
- **Pool configurável por ambiente.** Já ficou assim (`DATABASE_POOL_SIZE`, padrão 10). Para 20 corridas por segundo, 10 conexões sobram.
- **Transações mais curtas.** O POST faz INSERT e SELECT numa transação (o MySQL não tem `RETURNING`), e o PATCH faz UPDATE e SELECT. Menos idas ao banco liberam a conexão mais cedo.
- **Limiar do alerta da fila mantido em 100 mensagens por 5 minutos.** A fila ficou em zero mesmo com a API no limite, então um acúmulo que dura 5 minutos indica worker parado ou dependência lenta, e não pico de tráfego. Com os 80 eventos por segundo da rodada de 20 corridas, um worker parado passa de 100 mensagens em pouco mais de 1 segundo. O ponto fraco é o tráfego baixo: com um evento a cada 10 segundos, a fila levaria uns 17 minutos para chegar a 100.
- **Escalar o worker pela fila (KEDA, bônus da Parte 3) não ajudaria nesta carga.** Quem satura é a API; para ela, o caminho seria escalar por CPU.

## Como reproduzir

Com a stack de pé:

```bash
RATE_LIMIT_REQUESTS_PER_MINUTE=1000000 RATE_LIMIT_CREATES_PER_MINUTE=1000000 docker compose up -d --wait api
docker compose run --rm k6                              # 20 corridas por segundo
RIDES_PER_SECOND=60 docker compose run --rm k6
RIDES_PER_SECOND=100 docker compose run --rm k6         # rodada de saturação
DATABASE_POOL_SIZE=30 RATE_LIMIT_REQUESTS_PER_MINUTE=1000000 RATE_LIMIT_CREATES_PER_MINUTE=1000000 \
  docker compose up -d --wait api                       # pool de 30 conexões
RIDES_PER_SECOND=100 docker compose run --rm k6         # saturação de novo, com o pool maior
docker compose up -d --wait api                         # volta à configuração normal
```

Durante a rodada, as consultas da seção Observabilidade do README mostram o lado do servidor, e o Jaeger (http://localhost:16686) mostra os traces lentos: filtre o serviço `corridas-api` com duração mínima de 1 s.
