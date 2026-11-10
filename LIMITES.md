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
- **Checagem de versão no Redis não é atômica.** Com mais de um worker, dois poderiam ler a mesma versão e gravar fora de ordem. Com um worker, como aqui, não acontece. A solução seria um script Lua, que compara e grava de uma vez.
- **Contrato do evento duplicado.** O formato existe na API (tipo TypeScript) e no worker (schema zod). Em produção, um pacote compartilhado ou um schema registry.
- **Reconexão do worker.** Se a conexão com o RabbitMQ cair, o worker encerra e o Docker o reinicia. A API reconecta na publicação seguinte.

## Testes

- **Node e pnpm.** Os testes exigem Node 24 e pnpm. Subir e validar o sistema exige só Docker.
