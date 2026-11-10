# Limites

O que não fiz, o que faria com mais tempo e os riscos conhecidos que ficaram abertos.

## API

- **Idempotency-Key com corpo diferente.** Reenviar a mesma chave com outro corpo devolve a corrida original. O rascunho da IETF para o header sugere responder 422, o que exigiria guardar um hash do corpo junto com a chave.
- **Reenvio consome a cota.** O rate limit roda antes da lógica da rota, então um reenvio idempotente conta como requisição de criação. Um cliente que reenvie mais de 10 vezes no minuto recebe 429 e precisa esperar para descobrir o id da corrida já criada.
- **Motorista vê o id do passageiro.** As corridas disponíveis chegam ao motorista com o `passengerId`. Com os tokens de teste isso não é dado pessoal, mas com um provedor como o gov.br o `sub` é o CPF. Por minimização de dados (LGPD), a resposta para o motorista deveria omitir esse campo.
- **Credencial da API com privilégio de migração.** Como a migração roda no start, a API usa um usuário com todos os privilégios no schema. Separando a migração do start, a API poderia usar um usuário só com SELECT, INSERT e UPDATE.
- **Corpo malformado antes do 401.** O parser de JSON do Express roda antes dos guards: um POST sem token e com JSON quebrado recebe 400, e um corpo acima de 10 KB recebe 413, antes da checagem do token. Não vaza dados, mas difere da leitura literal de "sem token responde 401".
- **Rate limit em memória.** Cada réplica da API conta separado, então com N réplicas o limite efetivo vira N vezes maior. Com várias réplicas, o contador iria para o Redis.
- **Tokens de teste.** Valem 1 ano. Não há refresh token nem revogação.
- **MySQL sem TLS.** A conexão usa `allowPublicKeyRetrieval` porque não há TLS no compose. Em produção, TLS.
- **Migração no start.** O container da API aplica as migrações ao subir; com várias réplicas, o Prisma serializa as execuções com um lock no banco. Em produção eu rodaria a migração como uma etapa separada do deploy.

## Mensageria, worker e cache

- **Sem Outbox.** Se o RabbitMQ cair entre o commit no MySQL e a publicação, o evento se perde e o histórico fica incompleto.
- **Primeira subida.** Se a API publicar antes de o worker declarar a fila, a mensagem não tem para onde ir e é descartada. No compose, a API só sobe depois que o worker fica saudável. Em outro ambiente, a topologia precisaria ser declarada antes (definitions do RabbitMQ) ou a API publicaria com `mandatory` e trataria a devolução.
- **Credenciais administrativas.** O worker usa o usuário root do MongoDB e o administrador do RabbitMQ. Em produção, usuários de aplicação com permissão mínima.
- **DLQ sem reprocessamento automático.** Mensagens na `rides.worker.dlq` precisam ser devolvidas à fila à mão.
- **Dead letter at-most-once.** É o padrão das quorum queues: se a DLQ estiver indisponível no momento, a mensagem se perde. O modo at-least-once exige `x-dead-letter-strategy` e `x-overflow: reject-publish`.
- **Evento antigo com a chave ausente.** A checagem de versão compara com o que está no Redis. Se a chave já expirou ou foi apagada e chega um evento antigo (por exemplo, reprocessado da DLQ), ele é gravado e fica até o próximo evento ou até o TTL.
- **Eventos forjados.** Quem tiver credencial de publicação no RabbitMQ consegue publicar um evento falso, e o worker o grava no histórico e no cache, que o `GET` usa para autorizar a leitura. Aqui todos os serviços usam o mesmo usuário administrador. Em produção: um usuário por serviço, com a API só publicando no exchange e o worker só consumindo a fila.
- **Dados pessoais sem retenção.** O histórico e a DLQ guardam origem, destino e o id do passageiro sem prazo de expiração. Com dados reais, seria preciso uma política de retenção (por exemplo, índice TTL no MongoDB) por causa da LGPD.
- **Schema do evento mais frouxo no worker.** O worker aceita alguns valores que a API nunca publicaria (origem com menos de 3 caracteres, por exemplo).
- **Contrato do evento duplicado.** O formato existe na API (tipo TypeScript) e no worker (schema zod). Em produção, um pacote compartilhado ou um schema registry.
- **Reconexão do worker.** Se a conexão com o RabbitMQ cair, o worker encerra e o Docker o reinicia. A API reconecta na publicação seguinte.

## Observabilidade

- **Alertas sem notificação.** Não há Alertmanager; os alertas só aparecem na tela do Prometheus.
- **Regras sem teste automatizado.** O CI valida a sintaxe com o `promtool` e confere que os dois arquivos de alerta são iguais, mas não testa se cada regra dispara no cenário certo. O `promtool test rules` faz isso com séries simuladas.
- **`/metrics` sem autenticação.** Chegam nele a rede do compose e o próprio host, porque as portas são publicadas em `127.0.0.1`. O proxy da interface só repassa `/api/corridas`. Em produção, uma NetworkPolicy no cluster ou autenticação no scrape.
- **Logs só na saída do container.** Não há agregador (Loki, Elasticsearch); a busca pelo correlation id é com `docker compose logs`.
- **Logs sem rotação e sem limite antes da autenticação.** Cada requisição gera uma linha, inclusive as sem token, e o Docker guarda os logs sem limite de tamanho. Em produção, rotação no coletor e rate limit por IP no ingress, antes da autenticação.
- **Requisição recusada pelo parser de JSON fica fora do log.** Ela devolve o `X-Correlation-Id` e entra na métrica (rota `unmatched`), mas o parser roda antes do pino-http e não gera linha de log.
- **Subida da API com texto fora do JSON.** O `prisma migrate deploy` roda no mesmo container, antes da API, e escreve texto. Com a migração separada do start, o container da API escreveria só JSON.
- **Alertas dependem da coleta.** Se o Prometheus deixar de coletar a API ou o RabbitMQ, as séries somem e nenhum dos dois alertas dispara. Em produção, um alerta de `up == 0` cobre o alvo fora do ar.
- **Rótulo `service` no cluster.** O PrometheusRule filtra por `service="corridas-api"`, que vem do prom-client. Com um ServiceMonitor do Prometheus Operator, o rótulo `service` recebe o nome do Service do Kubernetes: o Service precisa se chamar `corridas-api`, ou o ServiceMonitor precisa de `honorLabels: true`.
- **Sem spans do NestJS.** A instrumentação oficial do Nest aceita até a versão 11. O trace mostra HTTP (com o nome da rota), Prisma, Redis, RabbitMQ e MongoDB, mas não os guards, os pipes e o controller.
- **Spans perdidos ao encerrar.** O SDK envia os spans em lote, a cada poucos segundos, e não é finalizado junto com o processo: os últimos spans antes de um restart se perdem.
- **`traceparent` do cliente aceito.** A API continua o trace que vier no header, então um cliente pode escolher o trace id ou pedir para não amostrar. Na borda (ingress), o certo é descartar o `traceparent` externo.
- **Amostragem de 100% e Jaeger em memória.** Toda requisição vira trace, e os traces somem quando o Jaeger reinicia. Em produção: amostragem por taxa ou no coletor, armazenamento persistente e um OpenTelemetry Collector entre os serviços e o Jaeger.
- **Atraso medido entre dois relógios.** O `worker_event_lag_seconds` compara o horário do evento, gerado na API, com o do worker. No compose é o mesmo host; em produção, depende de os relógios estarem sincronizados (NTP).

## Kubernetes (Parte 3, não feita)

Como eu faria, com o que o projeto já tem:

- **Cluster local com kind e manifestos com Kustomize**, sem template: um Deployment e um Service para a API, o worker e a interface, e a infraestrutura (MySQL, RabbitMQ, Redis, MongoDB) em StatefulSets simples, só para o ambiente local.
- **Probes:** a API e o worker já expõem `/health/live` (o processo responde) e `/health/ready` (a API consegue consultar o MySQL; o worker está consumindo). Liveness reinicia o pod travado; readiness tira o pod do Service enquanto ele não consegue atender.
- **Resources, a partir do teste de carga:** a 20 corridas por segundo, a API usou 0,45 núcleo e uns 420 MB, e o worker, 0,13 núcleo e uns 230 MB. Na saturação, a API chegou a 1,2 núcleo e 540 MB. Eu começaria com requests perto do consumo normal (API com 500m e 512Mi, worker com 200m e 256Mi) e limite de memória com folga sobre o pico (768Mi e 384Mi). Sem limite de CPU, para não estrangular a API quando ela já é o gargalo.
- **Configuração:** ConfigMap para o que não é segredo (issuer e audience do JWT, TTL do cache, tamanho do pool) e Secret para as URLs com senha, gerado por script a partir de variáveis de ambiente, nunca versionado. A chave pública do JWT pode ir num ConfigMap.
- **Migração como Job** antes do Deployment da API, em vez de rodar no start do container.
- **Escala:** o teste de carga mostrou que quem satura é a API, então eu começaria com um HPA por CPU na API, com o rate limit movido para o Redis. O KEDA, escalando o worker pelo tamanho da fila, seria o bônus, mas nesta carga a fila nunca acumulou.

## Interface

- **Login de teste.** O login é colar um token. Em produção seria o fluxo do provedor de identidade (OpenID Connect), com o token num cookie HttpOnly gerenciado por um backend da interface, fora do alcance de scripts da página.
- **Polling.** Cada tela aberta faz uma requisição a cada 2 ou 3 segundos. Com muitos usuários, SSE ou WebSocket reduziria a carga.
- **Telas sem paginação.** As listas mostram as 20 corridas mais recentes (para o motorista, só as dele em andamento e as disponíveis).
- **Token nos artefatos do e2e.** Quando um teste e2e falha, o trace, o vídeo e a captura do Playwright guardam o token digitado, e o CI sobe esses arquivos como artefato. São tokens de teste; com credenciais reais, seria preciso mascarar o campo ou não guardar o trace.

## Testes

- **Node e pnpm.** Os testes exigem Node 24 e pnpm. Subir e validar o sistema exige só Docker.
