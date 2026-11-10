# Decisões

Registro das decisões relevantes: contexto, alternativas consideradas, o que escolhi e o trade-off aceito.

## 1. Acesso à API: JWT com chave pública e rate limit por usuário

**Contexto.** O enunciado pede validação de JWT com token estático pré-gerado, usando JWKS ou chave pública, com 401 para token ausente ou inválido e 403 por perfil.

**Alternativas.**

- Segredo compartilhado (HS256): o mesmo segredo assina e valida.
- JWKS: a API busca as chaves públicas numa URL do provedor de identidade.
- Chave pública RS256 em arquivo.

**Escolha.** Chave pública RS256.

- Um script (`auth-dev/generate-tokens.mjs`) gera o par de chaves, assina os tokens de teste e descarta a chave privada.
- A API recebe só a chave pública, por volume.
- Na validação, o algoritmo é fixo (RS256), e emissor, audiência e validade são obrigatórios.

**Por quê.** Com HS256, a API guardaria o mesmo segredo que assina e poderia fabricar tokens; com chave pública, quem valida não consegue emitir. JWKS seria o caminho com um provedor real (Keycloak, gov.br), porque permite trocar a chave sem reiniciar a API, mas aqui exigiria um serviço a mais só para servir um arquivo.

**Trade-off.** Trocar a chave exige reiniciar a API, e os tokens de teste valem 1 ano.

**Rate limit.**

- **Biblioteca:** `@nestjs/throttler`.
- **Chave do contador:** usuário do token e rota. Cada usuário pode fazer até 120 requisições por minuto em cada rota e até 10 requisições de criação de corrida por minuto. Reenvios idempotentes também contam. Acima disso, a API responde 429 com `Retry-After`.
- **Por usuário e não por IP:** atrás do proxy da UI, todos chegariam com o mesmo IP.
- **Depois da autenticação:** requisição sem token já para no 401, com custo desprezível. Proteção contra enxurrada sem token é papel da borda (proxy, ingress, WAF).
- **Trade-off:** o contador fica em memória, então cada réplica da API conta separado.

## 2. O banco garante as regras que não podem falhar sob concorrência

**Contexto.**

- Um reenvio do POST, por timeout ou rede instável, não pode criar uma segunda corrida.
- Dois motoristas não podem aceitar a mesma corrida.

**Alternativas.**

- Checar na aplicação antes de gravar (SELECT, depois INSERT ou UPDATE).
- Trava distribuída no Redis.
- Deixar o próprio MySQL garantir.

**Escolha.** O MySQL garante.

- **Idempotência:** índice único em `(passenger_id, idempotency_key)`. Se o INSERT viola o índice, a API busca e devolve a corrida que já existe, com o header `Idempotent-Replayed: true`. Sem o header `Idempotency-Key`, a resposta é 400.
- **Aceite concorrente:** `UPDATE rides SET status = 'accepted', ... WHERE id = ? AND status = 'requested'`. Se nenhuma linha mudou, outro motorista chegou antes, e a API responde 409.

**Por quê.** Checar e depois gravar na aplicação deixa uma janela entre a checagem e a gravação, e duas requisições simultâneas passam juntas por ela. O banco é o único ponto que enxerga as duas ao mesmo tempo, e tanto o índice único quanto o UPDATE condicional são atômicos. Uma trava no Redis não seria atômica junto com o INSERT no MySQL.

**Detalhe que a revisão pegou.** A collation padrão do MySQL compara texto ignorando maiúsculas, acentos e espaço no fim. Para as regras do banco valerem, `passenger_id`, `driver_id` e `idempotency_key` usam comparação binária (`utf8mb4_bin`); senão `Ana` seria dona das corridas de `ana`.

**Trade-off.** A mesma chave enviada com um corpo diferente devolve a corrida original em vez de um erro (ver LIMITES).

## 3. Evento publicado depois de salvar, sem Outbox

**Contexto.** A API grava no MySQL e precisa avisar o worker por um evento no RabbitMQ.

**Alternativas.**

- Publicar antes de salvar.
- Publicar depois de salvar.
- Transactional Outbox: gravar o evento numa tabela, na mesma transação da corrida, e um processo separado publicar.

**Escolha.** Publicar depois de salvar, esperando a confirmação do broker (publisher confirm) por até 2 segundos.

**Por quê.** Publicar antes cria evento fantasma se o INSERT falhar. O Outbox é a forma correta de não perder evento, mas exige tabela, processo de publicação e cuidados de concorrência; preferi entregar algo que sei explicar inteiro. Publicar depois funciona sempre que o RabbitMQ está de pé.

**Trade-off.** Se o RabbitMQ cair entre o commit e a publicação, o evento se perde. A corrida continua no MySQL e a API segue lendo dela (o cache cai para o MySQL), mas o histórico no MongoDB fica sem esse evento. A falha aparece no log da API. Com mais tempo, eu faria o Outbox.

## 4. Topologia do RabbitMQ

**Contexto.** O worker recebe dois tipos de evento, precisa aguentar mensagem duplicada e falha temporária, e separar mensagens que nunca vão funcionar.

**Escolha.**

- **Exchange `rides`, do tipo topic.** A API publica com a routing key igual ao tipo do evento (`corrida.criada`, `corrida.status_alterado`). A fila do worker se liga com o padrão `corrida.*`. Um consumidor novo, como notificações, cria a própria fila e o próprio binding sem mudar a API.
- **Fila `rides.worker`, do tipo quorum.** É durável e é o tipo recomendado no RabbitMQ 4. O worker usa ack manual e prefetch 10 (até 10 mensagens em processamento ao mesmo tempo).
- **Falha temporária** (MongoDB ou Redis fora): o worker rejeita com requeue. A fila quorum do RabbitMQ 4.3 reentrega com espera crescente (1 s, 2 s, 3 s, até 10 s). Depois de 11 entregas (a original e mais 10), em cerca de 55 segundos, a mensagem vai para a DLQ.
- **Mensagem inválida:** rejeitada sem requeue, vai direto para a DLQ (`rides.dlx`, do tipo fanout, ligada a `rides.worker.dlq`).

**Alternativas.**

- Fanout, que não roteia por tipo.
- Requeue imediato, que vira um loop quente enquanto o MongoDB estiver fora.
- Fila de espera com TTL e dead letter, o padrão antes do RabbitMQ 4.3, com mais peças para manter.

**Trade-off.** Depende do RabbitMQ 4.3 ou mais novo. A janela de tolerância é de cerca de 55 segundos: no teste, o worker falhou 7 vezes e processou quando o MongoDB voltou. Uma queda maior manda os eventos para a DLQ, que é reprocessada à mão.

**Mensagem duplicada (entrega "pelo menos uma vez").** O RabbitMQ pode entregar a mesma mensagem mais de uma vez, por exemplo se o worker cair depois de gravar e antes do ack. Cada efeito é idempotente por si:

- **MongoDB:** o `_id` do documento é o `eventId`. A segunda gravação falha com chave duplicada e é tratada como "já processado".
- **Redis:** só grava se a versão do evento for maior que a do cache. A comparação e a gravação acontecem num script Lua, que o Redis executa inteiro sem intercalar outros comandos. Sem isso, duas mensagens da mesma corrida processadas ao mesmo tempo (o prefetch permite até 10) podiam ler a mesma versão e a mais antiga gravar por último; a revisão reproduziu o status voltando em 11 de 50 corridas.
- **Ordem dos efeitos:** o cache é atualizado mesmo quando o histórico diz "duplicado", porque o worker pode ter caído entre o MongoDB e o Redis.

## 5. Cache

**Contexto.** O enunciado pede que o `GET /corridas/:id` use cache e que o worker atualize o cache.

**Escolha.**

- **Escrita pelo worker:** a cada evento, o worker grava a corrida no Redis com TTL de 5 minutos, só se a versão for mais nova.
- **Leitura pela API (cache-aside):** o `GET` lê do Redis; se não achar (MISS), lê do MySQL e preenche o cache com `SET NX`, que só grava se a chave não existir, para não sobrescrever uma versão mais nova do worker. O header `X-Cache` mostra `HIT` ou `MISS`.
- **Escritas:** o `PATCH` decide sempre pelo MySQL, nunca pelo cache, e apaga a chave da corrida depois do commit (invalidação). A leitura seguinte vem do MySQL, então fica correta mesmo com o RabbitMQ ou o worker fora; o worker volta a deixar a chave quente quando processa o evento.
- **Redis fora:** o `GET` vira MISS e segue pelo MySQL.

**Alternativas.**

- Write-through na API, gravando o cache a cada alteração; deixaria o worker sem papel no cache.
- Só cache-aside, com a API invalidando a chave a cada alteração.

**Trade-off.** A leitura logo depois de uma mudança costuma ser MISS e ir ao MySQL. Há uma janela rara: um `GET` que leu o MySQL antes do commit e grava no cache depois da invalidação deixa a versão anterior até o worker processar o evento (ou o TTL de 5 minutos expirar).

## 6. MySQL para corridas, MongoDB para histórico

- **Corridas no MySQL, a fonte da verdade:** é um dado relacional e transacional, que precisa de índice único (idempotência) e de update condicional (aceite concorrente).
- **Histórico no MongoDB:** é append-only, com um documento por evento e o retrato da corrida naquele momento. É consultado por corrida (índice em `rideId` e `version`), e o formato do evento pode evoluir sem migração.
- **Trade-off:** dois bancos para operar.

## Notas sobre a interface

- **Polling em vez de SSE ou WebSocket.** A tela consulta a corrida a cada 2 segundos. É o que o `GET` com cache foi feito para aguentar, e não exige conexão aberta nem distribuir eventos entre réplicas da API. Com mais tempo, eu usaria SSE alimentado pelo próprio worker.
- **Mesma origem pelo nginx.** O nginx da interface serve os arquivos e repassa `/api` para a API. O navegador fala com uma origem só, então não há CORS para configurar. O nginx também envia uma Content-Security-Policy restritiva (`default-src 'self'`).
- **Token no sessionStorage.** É o mínimo para um login de teste colando o token. Some ao fechar a aba, mas um script injetado na página conseguiria lê-lo. A CSP restringe de onde vêm os scripts, o que dificulta a injeção, sem eliminar o risco (ver LIMITES).
- **Idempotency-Key na tela.** A chave representa a intenção: reenviar o mesmo pedido depois de um erro de rede reaproveita a chave, e a API devolve a corrida em vez de criar outra. Mudar origem ou destino é outro pedido, com chave nova.

## Interpretações de pontos ambíguos

- **`GET /corridas` (lista):** não está no enunciado, mas a tela precisa listar e o motorista precisa achar o que aceitar. Li "motorista só altera status" como "das escritas, o motorista só altera status". O passageiro lista as próprias corridas. O motorista lista as dele por padrão e as solicitadas com `?available=true`. A primeira versão misturava as duas numa lista só, cortada em 50, e as corridas do motorista sumiam quando havia muitas solicitadas mais novas; o QA pegou.
- **403 em vez de 404:** corrida de outro passageiro responde 403. O enunciado pede para demonstrar o 403, e os IDs são UUID, difíceis de adivinhar. Em produção eu avaliaria responder 404, para não confirmar que o ID existe.
- **Finalizar corrida sem motorista:** responde 409, porque é o estado que não permite a mudança. O 403 fica para quando a corrida é de outro motorista.
