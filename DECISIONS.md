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
- **Chave do contador:** usuário do token e rota. Cada usuário pode fazer até 120 requisições por minuto em cada rota e até 10 criações de corrida por minuto. Acima disso, a API responde 429 com `Retry-After`.
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

**Trade-off.** A mesma chave enviada com um corpo diferente devolve a corrida original em vez de um erro (ver LIMITES).

## Interpretações de pontos ambíguos

- **`GET /corridas` (lista):** não está no enunciado, mas a tela precisa listar e o motorista precisa achar o que aceitar. Li "motorista só altera status" como "das escritas, o motorista só altera status": ele lê as corridas disponíveis e as que aceitou.
- **403 em vez de 404:** corrida de outro passageiro responde 403. O enunciado pede para demonstrar o 403, e os IDs são UUID, difíceis de adivinhar. Em produção eu avaliaria responder 404, para não confirmar que o ID existe.
- **Finalizar corrida sem motorista:** responde 409, porque é o estado que não permite a mudança. O 403 fica para quando a corrida é de outro motorista.
