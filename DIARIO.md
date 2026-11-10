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
