# Diário de bordo

Registro cronológico e informal: o que tentei, o que quebrou, como investiguei e o que aprendi.

## 2026-11-09

- Li o PDF. A primeira versão do plano (montada com IA) tinha outbox transacional, retry com atraso nativo do RabbitMQ 4.3, script Lua no Redis, JWKS e kind rodando dentro de um container. Ao ler, percebi que não conseguiria explicar tudo aquilo com segurança na entrevista. Reescrevi o plano com a versão mais simples de cada requisito. O que ficou de fora vai para o LIMITES com a explicação de como eu faria.
- Escopo: Partes 1 e 2. Kubernetes só se sobrar fôlego. O próprio PDF diz que uma Parte 1 sólida vale mais do que três partes superficiais.
- `npm view prisma version` devolveu `8.0.0-rc.33`. A dist-tag `latest` do CLI aponta para um RC, enquanto o `@prisma/client` está em `7.10.1`. Se eu instalasse sem versão, o CLI e o client ficariam desalinhados. Fixei 7.10.1 nos dois.
- `typescript@latest` é a 7.0.2, mas o typescript-eslint aceita só até a 6.0 e a CLI do NestJS 12 pede a 6.0. Fixei o TypeScript em 6.0.3.
- Healthcheck do MySQL: pesquisando o entrypoint da imagem oficial, vi que durante a inicialização o mysqld sobe um servidor temporário sem rede. Um `mysqladmin ping` pelo socket responderia antes de o banco estar pronto de verdade, então o healthcheck usa TCP em `127.0.0.1`.
- Revisão da Fase 0 por dois agentes, um de código e um de segurança. O que encontraram:
  - **Painéis abertos:** o RabbitMQ (15672) e o Prometheus (9090) estavam publicados em `0.0.0.0`. No meu WSL ninguém da rede alcança, mas no Linux de quem avalia a porta ficaria aberta para a rede local, com a senha de dev que vai estar no GitHub. Passei para `127.0.0.1`.
  - **Healthcheck do Mongo:** a mesma armadilha do MySQL, que eu tinha evitado num e esquecido no outro. Durante o init, o mongod temporário escuta só em localhost, e o healthcheck passava cedo demais. O revisor reproduziu com um script de init lento. Agora o check conecta pelo hostname do container.
  - **RabbitMQ sem hostname fixo:** o nome do nó vem do hostname, e os dados ficam numa pasta com esse nome. Cada container novo ganhava um nome aleatório, então um `down`/`up` perderia as filas.
  - **TypeScript 6:** a opção `types` passou a ser vazia por padrão, e sem `"types": ["node"]` nem `process` é encontrado.
- Decidi não criar o banco "shadow" que o `prisma migrate dev` exige (o usuário da aplicação não pode criar bancos, e não quero dar esse privilégio a ele). Vou gerar as migrações com `prisma migrate diff`, que não precisa desse banco.

## 2026-11-09 (Fase 1: API)

- O Prisma 7 exige a `DATABASE_URL` até para o `prisma generate`, que nem conecta no banco: o helper `env()` do `prisma.config.ts` lança erro se a variável faltar. Troquei por `process.env.DATABASE_URL ?? ''`. O generate passou a funcionar sem URL, e o `migrate deploy` sem URL falha com "Connection url is empty", que é claro.
- O pnpm 12 parou o `install` com `ERR_PNPM_IGNORED_BUILDS`: ele só roda scripts de instalação de pacotes liberados explicitamente. Liberei só os dois do Prisma (`allowBuilds`).
- A API não subiu porque a porta 3000 estava ocupada por outro projeto meu. Deixei a porta do host configurável (`API_PORT`), com 3000 como padrão. Quem for avaliar pode ter o mesmo problema.
- O smoke com `curl` pegou um bug: finalizar uma corrida que ninguém aceitou respondia 403 "a corrida é de outro motorista". A corrida não tinha motorista (`driver_id` nulo), e o código tratava "não é minha" como "é de outro". A decisão entre 403 e 409 virou uma função pura, com teste para os quatro casos.
- Os testes de API passaram na primeira rodada e falharam na segunda: a suíte esbarrou no próprio rate limit de 10 criações por minuto. Gerei mais duas personas e distribuí as criações, no máximo 3 por persona por rodada. Rodei 3 vezes seguidas para confirmar.
- Lendo o código do `@nestjs/throttler`, vi que a chave do contador é controller + método + usuário. O limite vale por usuário **em cada rota**, e não como um total por usuário. Ajustei a documentação para dizer exatamente isso.
- Revisão da Fase 1: um workflow com três agentes em paralelo (código, segurança e QA exploratório) e, para cada um, um verificador cético tentando refutar os achados. Vieram 18 achados, todos confirmados com evidência. O que mais me ensinou:
  - **A lista do motorista** juntava as corridas solicitadas de todo mundo com as dele e cortava em 50. Com a suíte criando corridas, logo havia mais de 50 solicitadas mais novas, e as corridas que o motorista tinha aceitado sumiam da lista dele. Separei em duas visões: "minhas" e `?available=true`.
  - **Collation:** eu tinha anotado a collation `_ci` do MySQL só como risco de idempotência ("abc" igual a "ABC"). Os revisores mostraram que é risco de autorização: o `WHERE passenger_id = 'PASSAGEIRO-1 '`, com maiúsculas e espaço no fim, devolvia as corridas de `passageiro-1`. Corrigi com uma migração para `utf8mb4_bin` e conferi que a consulta com outra caixa volta 0.
  - **Imagem Docker:** tinha 1,26 GB. Uns 400 MB eram cache do pnpm, do corepack e do Prisma esquecidos na camada final. Caiu para 698 MB.
  - **Header `Authorization`:** pela RFC 9110, o nome do esquema não diferencia maiúsculas, e eu recusava "bearer".
  - **Mensagem do 409:** revelava o status de uma corrida que o motorista não podia ler.
  - **Teste unitário:** eu testava uma função (`isTransitionAllowed`) que a produção nem usava. Passei a testar a que o service usa.
- O que ficou como limite, e não correção: o motorista vê o id do passageiro (LGPD), a API usa a mesma credencial que aplica as migrações, e o reenvio idempotente consome a cota do rate limit.

## 2026-11-09 (Fases 2 e 3: RabbitMQ, worker, MongoDB e Redis)

- Escolhi não reconectar o worker automaticamente: se a conexão com o RabbitMQ cair, o processo encerra e o Docker reinicia (`restart: unless-stopped`). As mensagens sem ack voltam para a fila, e o worker é idempotente. É o jeito mais simples que sei explicar.
- Testei a falha temporária de verdade: derrubei o MongoDB, criei uma corrida e o worker falhou 7 vezes, com intervalos crescentes (6 s, 7 s, 8 s...: 5 s de timeout do driver mais 1 s, 2 s, 3 s de espera do RabbitMQ). Religuei o MongoDB e ele processou na tentativa seguinte, sem cair na DLQ.
- Antes disso, o driver do MongoDB esperava até 30 s para desistir de cada operação, e o worker ficava parado nesse tempo. Baixei o `serverSelectionTimeoutMS` para 5 s, para a falha aparecer rápido e o ritmo das novas tentativas ficar com o RabbitMQ.
- Logo depois de subir, a fila mostrava 1 mensagem com o consumidor ativo. Investiguei com `rabbitmqctl list_queues name messages_ready messages_unacknowledged`: era a mensagem sendo processada no instante da listagem.
- As suítes da API e do worker usavam o mesmo passageiro-2 e esbarraram juntas no rate limit (429). Criei a passageiro-6, exclusiva dos testes do worker.
- O teste do "evento atrasado não faz o status voltar" passaria mesmo sem a checagem de versão se a chave do cache tivesse expirado, porque a leitura viria do MySQL. Passei a exigir `X-Cache: HIT` no teste.
- Para o README, o `curl` na API HTTP do painel exigia escapar o JSON com `sed`. Descobri que a imagem do RabbitMQ traz o `rabbitmqadmin` 2, e o comando ficou legível.
- Testei o Redis fora do ar. A API seguiu respondendo: `GET` em 4 ms vindo do MySQL (`X-Cache: MISS`), `POST` 201 e readiness 200. No worker, o evento da corrida criada nesse intervalo gravou o histórico no MongoDB, falhou no cache e voltou para a fila. Quando o Redis subiu, a reentrega encontrou o histórico já gravado ("duplicado") e completou o cache. Foi exatamente o caso que me fez atualizar o cache mesmo quando o evento é duplicado.
- Revisão das Fases 2 e 3, de novo com três agentes e verificação cética. O achado mais importante desmentiu algo que eu tinha escrito no LIMITES: "com um worker, a checagem de versão do cache não tem corrida". Tem, porque o prefetch 10 faz o próprio worker processar até 10 mensagens ao mesmo tempo, e o GET seguido de SET deixava uma versão antiga gravar por último. O revisor publicou em rajada as versões 1, 2 e 3 de 50 corridas, e 11 terminaram com o status errado no cache. Troquei por um script Lua, que compara e grava de uma vez, e criei um teste com 40 corridas em rajada, em ordem e invertidas.
- Outros achados corrigidos:
  - **Prazo do publicador:** os 2 s só valiam para a confirmação, não para a conexão. Com o broker travado, o `POST` ficava pendurado. Agora a operação inteira tem prazo, e a conexão tem timeout. Testei pausando o container do RabbitMQ: `POST` e `PATCH` voltaram em 2,0 s.
  - **Retrato errado no `PATCH`:** com aceitar e iniciar ao mesmo tempo, a leitura feita depois do `UPDATE` podia pegar a mudança seguinte, e o histórico perdia o `accepted`. Coloquei o `UPDATE` e a leitura na mesma transação. Testei com 8 corridas: todas ficaram com as versões certas.
  - **Cache sem o RabbitMQ:** com o RabbitMQ fora, o cache servia o status antigo por até 5 minutos, porque só o worker atualizava. Agora o `PATCH` apaga a chave, e a leitura seguinte vem do MySQL.
  - **Consumo cancelado:** se o RabbitMQ cancelasse o consumo, o worker continuava "saudável" sem consumir nada. Agora ele encerra e o Docker reinicia.
  - **Logs do worker:** o erro do Redis no log trazia os argumentos do comando, ou seja, a corrida inteira com dados do passageiro. Passei a logar só a mensagem do erro.

## 2026-11-09 (Fase 4: interface, e2e e CI)

- Escrevi a interface num rascunho fora do repositório enquanto os revisores da fase anterior liam o código. Assim não mudei os arquivos nem o `node_modules` que eles estavam usando.
- O e2e passou de primeira no Google Chrome do WSL (`channel: 'chrome'`): o passageiro pede a corrida e acompanha o motorista aceitar, iniciar e finalizar.
- No QA visual, com capturas de tela, vi que na tela do motorista as "Corridas disponíveis" vinham primeiro. Com as corridas criadas pelos testes, a lista empurrava "Minhas corridas" (onde ficam Iniciar e Finalizar) para fora da tela. Inverti a ordem.
- Primeiro deixei um `eslint-disable` do plugin `react-hooks` no hook de polling. O plugin nem está instalado, então o ESLint acusaria uma regra inexistente. Tirei a diretiva e mantive só o comentário explicando a escolha das dependências do `useEffect`.
- Criei a persona passageiro-7, só para o e2e, pelo mesmo motivo da 6: não disputar a cota do rate limit com as outras suítes.
- Revisão da Fase 4, agora com o QA usando Playwright no Chrome e tirando capturas. O achado mais sério: um duplo clique em "Aceitar" aceitava também a corrida de baixo. A lista do motorista se atualiza logo depois da primeira resposta, que leva uns 20 ms, e o segundo clique, uns 150 ms depois, caía no botão da corrida que tinha subido para o mesmo lugar. Os botões agora ficam travados durante a requisição e o segundo clique de um duplo clique é ignorado. Criei um e2e com duplo clique para isso não voltar.
- Outros achados da Fase 4:
  - **Reenvio com campos editados:** depois de um erro de rede, se o passageiro mudasse o destino e reenviasse, voltava a corrida antiga, porque a chave era a mesma. Agora a chave representa o pedido: mesmo pedido, mesma chave; pedido diferente, chave nova.
  - **Polling sobreposto:** o polling usava `setInterval`, e uma resposta lenta podia chegar depois de uma nova e fazer o status voltar na tela. Troquei por `setTimeout` encadeado, com uma leitura de cada vez.
  - **Aviso de erro do motorista:** ficava no topo da página, fora da área visível. Agora fica fixo.
  - **Sessão expirada:** um token que deixava de valer não levava de volta ao login. Agora leva.
  - **Interface aberta por HTTP fora de localhost:** a tela do passageiro ficava em branco, porque `crypto.randomUUID` só existe em contexto seguro. A chave agora vem de `crypto.getRandomValues`.
  - **nginx:** passou a esconder a versão, a proibir a interface dentro de iframe de outro site (`frame-ancestors`), a marcar as respostas da API como `no-store` e a resolver o nome da API de novo a cada 10 s.

## 2026-11-09 e 2026-11-10 (Fase 5: logs, métricas e alertas)

- Logs com `nestjs-pino` na API e `pino` no worker, os dois em JSON. Escolhi o correlation id em vez de esperar o trace_id do OpenTelemetry (Fase 6) porque ele já atravessa a fila sozinho: vai na propriedade `correlationId` da mensagem AMQP, que existe para isso.
- O `X-Correlation-Id` vindo do cliente só é aceito se for UUID. Sem essa checagem, qualquer texto enviado no header iria parar nos logs.
- A métrica HTTP começou a ser pensada como interceptor do Nest, mas os interceptors rodam depois dos guards: os 401, 403 e 429 ficariam fora da contagem. Virou um middleware do Express, que vê toda requisição.
- O rótulo da rota é o template (`/corridas/:id`) e não a URL. Com a URL, cada corrida viraria uma série nova no Prometheus. Um teste confere que o id não aparece no `/metrics`.
- Para provar a propagação do correlation id num teste automatizado, o worker passou a gravá-lo no histórico do MongoDB. O teste envia um id conhecido na API e o encontra no documento do histórico.
- O teste de mensagem duplicada esperava 500 ms "para dar tempo" de a segunda entrega chegar. Agora espera o contador `worker_messages_total{result="duplicate"}` subir, que é o sinal exato de que o worker viu a duplicata.
- O `/metrics` da API não tem autenticação, pensado para a rede interna. Mas o nginx da interface repassa `/api/*` para a API, então `/api/metrics` ficaria público. Bloqueei no nginx com regex sem diferenciar maiúsculas, porque o Express também não diferencia: testei `/api/METRICS`, `/api/metrics/`, `/api/%6Detrics` e `/api//metrics`, todos com 404.
- A descrição do alerta da fila dizia que o status no cache ficava atrasado. Revendo, não fica: o PATCH invalida o cache e a leitura seguinte vem do MySQL. O impacto real é o histórico atrasado e, se a fila crescer muito, o RabbitMQ bloquear as publicações. Corrigi a descrição e registrei o raciocínio no DECISIONS.
- Validei o alerta da fila ao vivo: worker parado, 120 mensagens publicadas pela API de gerenciamento do RabbitMQ, alerta em "pending" em menos de 20 s e de volta a "inactive" uns 20 s depois de religar o worker. Na primeira leitura, o `rabbitmqctl list_queues` mostrou a fila vazia logo depois das publicações; as estatísticas das filas são atualizadas de tempos em tempos, e alguns segundos depois apareceram as 121 mensagens.
- Revisão da Fase 5 com dois revisores, de segurança e de QA. O de código ficou de fora quando decidimos simplificar a verificação: daqui em diante, as suítes rodam a cada passo e fica uma revisão única no fim.
- Achado dos dois revisores: requisição recusada pelo parser de JSON (JSON quebrado, corpo acima de 10 KB) voltava sem o `X-Correlation-Id`. O parser roda antes do pino-http, que era quem gerava o id. O id passou a ser gerado num middleware registrado antes do parser, e o pino-http reaproveita o mesmo valor.
- Rota inexistente aparecia na métrica como `{/*splat}`, e não como `unmatched`: o nestjs-pino monta o próprio middleware nessa rota curinga, e o Express a deixa em `request.route`. Corrigido, com teste.
- O bloqueio de `/api/metrics` no nginx virou lista de permissão: só `/api/corridas` passa pelo proxy, e o resto de `/api` responde 404. Uma rota interna nova não fica pública por esquecimento.
- O worker aceitava qualquer texto na propriedade `correlationId` da mensagem; agora aceita só UUID, como a API.
- O roteiro de mensagem duplicada do README usava datas fixas, e o worker registrava um atraso de 30 horas na métrica. As datas agora são geradas na hora.

## 2026-11-10 (Fase 6: trace distribuído e teste de carga)

- OpenTelemetry no padrão que eu já usava em outro projeto: `node --import` carrega a instrumentação antes da aplicação, e o hook síncrono do `import-in-the-middle` fica só para os pacotes importados por ESM. O Nest 12 é ESM e importa o Express por `import`, então o Express entrou na lista; o pino, carregado por `require` dentro do nestjs-pino, não precisou.
- Antes de instalar, conferi a faixa de versões de cada instrumentação: amqplib 2, Express 5, ioredis 6 e mongodb 7 estão dentro; o Nest 12, não (vai até a 11). Escolhi versões publicadas havia pelo menos uma semana.
- O pnpm recusou a instalação por causa do postinstall do protobufjs, que veio com o SDK. O script só confere versões, então marquei como não permitido no `allowBuilds`.
- Testei a API instrumentada num container à parte, na porta 3200 e com um Jaeger próprio, enquanto os revisores usavam o ambiente. A instrumentação do Express gerava um span por middleware (parsers, pino, métricas); configurei para ela só dar nome à rota no span HTTP.
- A API de consulta antiga do Jaeger (`/api/traces`) não existe na 2.22; usei a `/api/v3`.
- O trace de ponta a ponta funcionou de primeira: o `traceparent` vai no header da mensagem, e o log do worker sai com o mesmo `trace_id` da requisição na API.
- Primeira rodada do k6 inválida: 94% das criações deram 429, com exatamente 210 sucessos (7 passageiros × 10 por minuto × 3 minutos). O `depends_on` do serviço k6 fez o `docker compose run` recriar a API com o rate limit padrão, desfazendo o limite alto que eu tinha acabado de subir. Tirei o `depends_on`.
- A 100 corridas por segundo, a escrita passou de 1 s. O trace de um PATCH lento mostrou 1,43 s de 1,5 s esperando em `start_transaction`, isto é, uma conexão do pool de 10. Deixei o pool configurável (`DATABASE_POOL_SIZE`) e confirmei a hipótese com 30 conexões: 18% a mais de throughput, e o limite passou a ser a CPU da API.
- Mantive o limiar do alerta da fila em 100: a fila ficou em zero em todas as rodadas, mesmo com a API saturada.
- Revisão final com um revisor só, de código e segurança. O achado mais sério: o span do Redis no worker levava a corrida inteira (passageiro, origem e destino) para o Jaeger. A instrumentação do ioredis grava todos os argumentos do `EVAL`, e o script de versão recebe a corrida em JSON, justamente o dado que eu já tirava do log. Agora os spans do Redis mostram só o nome do comando.
- Outros achados dessa revisão: o comentário do propagador dizia "só o traceparent", mas o `tracestate` também passa; `/HEALTH` em maiúsculas virava trace; os roteiros do teste de carga recriavam a API sem a porta escolhida (agora a porta fica no `.env`); e o relatório não mostrava a memória e a CPU do worker que o LIMITES cita.
- Antes da entrega, resolvi um limite anotado na Fase 1: o motorista não recebe mais o id do passageiro. O campo some só na resposta da API; o cache e o evento continuam com ele, porque a regra de leitura do passageiro depende dele.
- A suíte de API falhava se rodasse mais de 3 vezes no mesmo minuto, por causa do próprio rate limit. Agora ela espera o `Retry-After` e segue; rodei 4 vezes seguidas, e a segunda esperou uns 60 s.
- As regras de alerta ganharam teste no CI, com o `promtool` e séries simuladas. Conferi o caso negativo: com a fila parada em 90, abaixo do limiar, o teste acusa o alerta que não veio.
