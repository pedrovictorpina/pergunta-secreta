# Pergunta Secreta — Multiplayer com servidor

A versão anterior dependia de conexão direta entre computadores via PeerJS. Agora, as salas e as regras do jogo são controladas por um **servidor Node.js com Socket.IO**. A conexão tenta HTTP long-polling e WebSocket, aumentando a compatibilidade com redes diferentes. A pergunta e a resposta permanecem no servidor até o final da rodada.

## Executar no computador

Necessário Node.js 20 ou superior.

```bash
npm install
npm start
```

Abra http://localhost:3000 e crie uma sala. Para um teste local, abra outra janela anônima ou outro navegador e entre com o código.

**Atenção:** `localhost` só serve para testes na sua máquina. Para jogar com amigos em outros computadores, publique este projeto como serviço Web Node.js. Abrir o `public/index.html` diretamente ou enviar apenas o HTML ao Netlify Drop **não funciona**.

## Publicar para usar com amigos (Render)

1. Extraia o ZIP e envie os arquivos e pastas **como repositório** para o GitHub, mantendo `server.js`, `package.json` e a pasta `public` na raiz.
2. Entre no https://dashboard.render.com e escolha **New > Web Service**.
3. Conecte o repositório e selecione o plano **Free**, caso esteja disponível.
4. Configure **Build Command** como `npm install --omit=dev` e **Start Command** como `npm start`.
5. Quando o serviço ficar como **Live**, abra o link `https://...onrender.com` fornecido pelo Render.
6. Crie uma sala e compartilhe o link de convite exibido no jogo. Todos acessam o **mesmo site**.

O arquivo `render.yaml` pode ser usado como Blueprint, se preferir.

## Limitações importantes

- O serviço gratuito do Render pode entrar em repouso após 15 minutos sem tráfego. Ele reinicia com novo acesso; porém salas em memória se perdem quando o processo reinicia.
- A partida e o placar ficam na **memória do servidor**; não há persistência em banco de dados. Redeploys e reinicializações perdem as salas.
- Redes corporativas muito restritivas ainda podem bloquear a conexão ao serviço. O Socket.IO tenta HTTP long-polling como alternativa a WebSocket.
- Até 12 participantes por sala.
- O anfitrião não precisa manter a aba aberta durante o jogo: se ele cair, o servidor pode transferir essa função após alguns segundos para outro participante conectado.

## Controles da sala

- **Compartilhar sala** abre o menu do dispositivo quando disponível. **Copiar link de convite** funciona como alternativa.
- **Jogar também**: quem cria a sala organiza a partida e participa dos turnos normalmente.
- **Só organizar**: quem cria a sala inicia as rodadas, acompanha a partida e gerencia os participantes. O anfitrião fica fora dos turnos e do placar. É preciso ter pelo menos um jogador conectado para começar.
- **Sair da sala** (todos): remove o próprio participante imediatamente. Os outros continuam jogando. Se o anfitrião sair, a função é transferida para outra pessoa; se era o único participante, a sala é apagada.
- **Remover** (somente anfitrião): o botão fica ao lado do nome de cada outro participante, tanto na sala de espera quanto durante a rodada. Quem é removido recebe um aviso e perde o acesso à sessão anterior. A ordem de escolha e dos palpites se adapta aos participantes restantes.
- **Encerrar sala** (somente anfitrião): encerra a partida para todos, invalida o código e descarta os dados daquela sala. É diferente de sair.

A remoção impede o retorno usando a sessão anterior e o mesmo nome. Como não há contas de usuário, não é uma proibição de identidade infalível: alguém poderia tentar um nome diferente.

Durante a partida, o anfitrião pode **pausar e retomar** os turnos. Novos jogadores podem entrar enquanto a sala estiver pausada. Também pode **editar a próxima rodada**, escolhendo tema e dificuldade ou uma pergunta própria, e **reiniciar a partida**, zerando o placar e voltando à preparação da primeira rodada na mesma sala.

**Últimas jogadas** exibe todo o histórico da sala, com os eventos mais recentes no topo. O histórico continua disponível nas rodadas seguintes, após reiniciar e durante a revanche. Ele fica em memória enquanto a sala existir.

## Instalar no celular

1. Abra o endereço publicado em HTTPS.
2. No Android (Chrome), abra o menu do navegador e escolha **Instalar app** ou **Adicionar à tela inicial**. No iPhone (Safari), abra **Compartilhar**, toque em **Adicionar à Tela de Início** e confirme a abertura como app, se essa opção aparecer.
3. Abra o Pergunta Secreta pelo ícone e crie uma sala ou entre com o código. As partidas precisam de conexão com o servidor.

Ao reabrir o aplicativo, a sessão anterior é retomada se a sala ainda existir no servidor. Para encerrar sua sessão neste aparelho, use **Sair da sala**.

### Atualização de um site já publicado no Render

Substitua os arquivos do projeto no **mesmo repositório GitHub** usado pelo serviço Render e faça commit/push. O Render precisa publicar a nova versão para os botões funcionarem; não basta atualizar somente o HTML, pois existem mudanças no servidor (`server.js`). Os participantes que estavam em salas da versão anterior precisarão criar uma nova sala após a atualização, porque as salas ficam em memória.

## Regras

1. Alguém cria a sala e compartilha o link. Cada um entra com seu nome, inclusive com a partida em andamento. O anfitrião escolhe 5 ou 10 rodadas antes de começar.
2. Quem está na vez escolhe um número. A palavra revelada aparece **para todos** no tabuleiro e na prévia da pergunta com lacunas, acima do palpite.
3. Os palpites seguem automaticamente a ordem circular, começando por quem pediu a dica. Quem entra durante os palpites acompanha a jogada e participa a partir da próxima dica.
4. Cada pessoa pode tentar uma vez por palavra revelada. Se ninguém acertar, o próximo participante pede outra palavra.
5. Quem acerta ganha um ponto. No fim da partida, todos veem a classificação e os empates. O anfitrião pode preparar uma revanche na mesma sala, com o placar zerado.
6. Com um só jogador, ele pode pedir novas palavras após errar ou pular a tentativa.
7. Na pergunta surpresa, o anfitrião escolhe o tema e a dificuldade. A sala sorteia uma pergunta diferente a cada rodada até esgotar a combinação escolhida. Também é possível cadastrar uma pergunta própria.

### Temas e dificuldade

| Tema | Fácil | Médio | Difícil | Total |
| --- | ---: | ---: | ---: | ---: |
| Conhecimentos gerais | 167 | 167 | 166 | 500 |
| Filmes | 34 | 33 | 33 | 100 |
| Países | 34 | 33 | 33 | 100 |
| Música | 34 | 33 | 33 | 100 |
| Ciência e natureza | 34 | 33 | 33 | 100 |

O catálogo fica em `perguntas/`, no servidor Node.js. Cada entrada contém a pergunta e a resposta. Use `|` para separar respostas alternativas aceitas na mesma entrada.

Use o [roteiro de teste de dificuldade](docs/teste-dificuldade.md) para registrar casos durante partidas reais.

## Estrutura

- `server.js`: regras, salas e validação das jogadas
- `public/index.html`: interface do jogo
- `public/app.js`: comunicação com o servidor e controles
- `render.yaml`: configuração para o Render
- `tests/game.test.js`: testes automatizados (`npm test`, depois de `npm install`)

## Privacidade

Cada participante informa apenas um nome de exibição. A sessão é identificada por um token aleatório. No navegador, ele é salvo na aba. No aplicativo instalado, ele também fica salvo no armazenamento local para permitir a retomada. As respostas secretas não são transmitidas aos participantes antes da rodada acabar.
