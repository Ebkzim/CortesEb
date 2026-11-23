<div align="center">

# CortesEb

Transforma vídeos longos e lives em cortes.

[![CI](https://github.com/Ebkzim/CortesEb/actions/workflows/ci.yml/badge.svg)](https://github.com/Ebkzim/CortesEb/actions/workflows/ci.yml) [![Instalação](https://github.com/Ebkzim/CortesEb/actions/workflows/install.yml/badge.svg)](https://github.com/Ebkzim/CortesEb/actions/workflows/install.yml) [![CodeQL](https://github.com/Ebkzim/CortesEb/actions/workflows/codeql.yml/badge.svg)](https://github.com/Ebkzim/CortesEb/actions/workflows/codeql.yml)

![Node.js](https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=nodedotjs&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white) ![Linux e Windows](https://img.shields.io/badge/roda%20em-Linux%20%7C%20Windows-555) [![Conventional Commits](https://img.shields.io/badge/commits-conventional-FE5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org) [![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

</div>

---

## O que ele entrega

O CortesEb te dá um painel no navegador para cuidar de toda a criação de cortes. Vídeos, lives, séries, filmes e podcasts entram por ali, e os clipes saem prontos em 9:16, já editados e organizados pelas contas que você cadastrar.

Você faz um corte por vez, acompanhando cada etapa, ou monta uma fila com vários vídeos e deixa rodando para gerar quantos clipes quiser. Tudo roda no seu computador.

Se você usa o Claude Code, também pode pedir os cortes direto no chat com a skill que vem junto. É opcional: o painel não precisa de conta no Claude nem em outra IA e funciona de forma independente.

| Recurso               | Como funciona                                                              |
| --------------------- | -------------------------------------------------------------------------- |
| **Vídeos e lives**    | Corta vídeos gravados ou acompanha uma live e gera os cortes durante ela   |
| **Escolha por IA**    | Uma IA lê a transcrição e escolhe os trechos com mais chance de prender    |
| **Legenda**           | Palavra por palavra, com a palavra falada em destaque                      |
| **Edição**            | Remove as pausas, faz jump cuts com zoom e monta a câmera sobre o jogo     |
| **Tipos de conteúdo** | Gameplay, react, podcast, filmes e séries                                  |
| **Contas**            | Várias contas, cada uma com seu nome e sua logo na marca d'água (opcional) |
| **Fila**              | Vários vídeos de uma vez, processados em sequência                         |
| **Privacidade**       | Vídeos e cortes ficam na sua máquina e as chaves ficam criptografadas      |

**Não precisa pagar plano de IA.** O instalador já traz o Ollama com um modelo que roda no seu computador, e a transcrição também é local. Se quiser, dá para usar uma chave da Anthropic ou da OpenAI, ou deixar o Claude Code ou o Codex escolherem os cortes.

**Sem limite de uso.** Não tem conta, assinatura nem marca d'água de terceiros. Quantos vídeos o seu computador aguentar.

## Instalação no Windows

Funciona no Windows 10 e 11 (64 bits). Reserve uns 6 GB livres no disco.

**1. Instale o Node.js e o Git**

Baixe e instale os dois, sempre clicando em "Next" até o fim:

- Node.js: [nodejs.org](https://nodejs.org), botão da versão LTS
- Git: [git-scm.com/download/win](https://git-scm.com/download/win)

**2. Abra o terminal**

Aperte a tecla Windows, digite `cmd` e aperte Enter para abrir o terminal. Se ele já estava aberto, feche e abra de novo para reconhecer o que você acabou de instalar.

**3. Baixe o projeto e rode o instalador**

```bat
git clone https://github.com/Ebkzim/CortesEb.git
cd CortesEb
npm run instalar
```

Na primeira vez leva de 15 a 30 minutos. Se o Windows pedir permissão para instalar o Ollama, aceite.

**4. Abra o painel**

```bat
cortes-eb ui
```

O painel abre no navegador. Nas próximas vezes, basta abrir o terminal e rodar `cortes-eb ui`.

## Instalação no Linux

Testado no Ubuntu e derivados (64 bits). Reserve uns 6 GB livres no disco.

**1. Instale as ferramentas básicas**

```bash
sudo apt update
sudo apt install -y build-essential git curl
```

**2. Instale o Node.js**

O jeito mais simples é pelo nvm, que instala o Node.js só para o seu usuário:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh | bash
source ~/.bashrc
nvm install 22
```

**3. Baixe o projeto e rode o instalador**

```bash
git clone https://github.com/Ebkzim/CortesEb.git
cd CortesEb
npm run instalar
```

Na primeira vez leva de 15 a 30 minutos. Ele vai pedir sua senha para instalar o Ollama.

**4. Abra o painel**

```bash
cortes-eb ui
```

O painel abre no navegador. Nas próximas vezes, basta abrir o terminal e rodar `cortes-eb ui`.

## Contas e aquecimento

Na aba **Contas**, cadastre os perfis e conecte TikTok, Instagram e YouTube pelo Chrome. O login fica salvo separadamente para cada conta e rede. As mesmas contas continuam acessíveis em Configurações.

Selecione uma conta na lista e abra **Aquecimento** no cartão de uma rede. Em **Metas**, defina quantos vídeos assistir, curtir, comentar ou responder, o tempo de reprodução e o intervalo entre vídeos. Curtidas em comentários estão disponíveis no Instagram e no YouTube. Comentários e respostas usam o texto disponível na página e a IA escolhida em **Preferências**: Ollama, uma chave cadastrada no painel ou a configuração da CLI.

Em **Metas**, cada tempo pode ser **Fixo** ou **Variável**. O modo variável sorteia segundos inteiros dentro dos limites definidos: 5–120 segundos para assistir e 10–3.600 segundos de intervalo. O tempo é escolhido uma vez por ciclo e aparece na contagem regressiva; quando a faixa tem mais de um valor, o sorteio evita repetir o tempo anterior. Configurações antigas continuam fixas até você ativar uma faixa.

Em **Atividade**, veja a etapa atual, a contagem regressiva, os totais por ação e uma prévia compacta do navegador. O histórico tem busca, filtros e rolagem própria. A captura pode ser ampliada e não é uma transmissão ao vivo. A configuração fica bloqueada enquanto a sessão executa.

Em **Preferências → Modo de busca**, **Econômica** é o padrão para computadores mais fracos: espera 2,5 segundos entre tentativas de busca, reaproveita o vídeo ativo no feed do TikTok e limita as capturas comuns a uma a cada 20 segundos, com qualidade reduzida. **Padrão** espera 1,2 segundo entre tentativas e captura cada etapa. Estados que precisam de atenção recebem uma captura mesmo no modo econômico.

O modo por metas para ao concluir. O modo contínuo renova as metas à meia-noite, no horário do computador. Os contadores do dia são preservados ao parar e iniciar novamente; interações podem exigir assistir a mais vídeos que a meta. Mantenha o serviço do painel rodando para executar as sessões. Ao reiniciar o serviço, as sessões ficam paradas até você iniciá-las novamente.

Em **Preferências → Resolver verificações**, **No Chrome** abre a janela original diretamente, reduzindo o trabalho de captura e transmissão da tela. É a opção indicada para computadores mais lentos. O modo **No painel** continua disponível. Os vídeos são pausados durante a espera pela resolução manual.

Se uma rede pedir verificação, a página original permanece aberta e a resolução acontece na janela do Chrome ou na tela interativa, conforme o modo escolhido. Resolva manualmente; o aquecimento continua na mesma sessão. Cancelar encerra a espera e mantém o progresso salvo.

A publicação tem prioridade entre ciclos. O histórico registra tentativas e ações confirmadas; quando há verificação, sessão expirada ou uma ação sem confirmação, o aquecimento pausa para conferência. Tentativas já registradas não são repetidas automaticamente no mesmo vídeo. Um bloqueio de perfil impede login, publicação e aquecimento de abrirem o mesmo perfil do Chrome simultaneamente.

## Seguidores no Instagram

No cartão do Instagram, abra **Seguidores**. Escolha **Seguir** ou **Deixar de seguir**, a quantidade da sessão e o intervalo mínimo e máximo. Os modos não executam juntos na mesma conta. Pare e aguarde o encerramento antes de trocar de modo.

**Seguir** encontra perfis nos comentários de Reels e sorteia a ordem dos candidatos. Perfis já seguidos ou com solicitação pendente são ignorados. Solicitações enviadas a contas privadas entram na quantidade de ações, mas aparecem separadas dos vínculos confirmados em **Atividade**.

**Deixar de seguir** consulta a lista atual de pessoas que a conta segue, inclusive vínculos feitos fora do aplicativo. Antes de remover um perfil, pesquisa o nome exato nos seguidores da própria conta. Uma ausência só é aceita quando a busca da página retorna uma resposta vazia concluída e a interface mostra que não há resultados. Listas incompletas ou buscas sem confirmação mantêm o vínculo e registram o motivo. Se a versão do Instagram não disponibilizar essa confirmação, a sessão pode pausar sem fazer remoções.

O cronômetro de seguidores é independente do aquecimento. Um novo intervalo é sorteado após cada ação confirmada. O trabalhador compartilhado abre uma sessão de navegação por vez; um intervalo vencido pode aguardar outra navegação ou publicação. O painel mostra essa espera, o perfil atual, os totais e um histórico pesquisável.

Parar e retomar mantém os totais de uma sessão incompleta no mesmo modo. Iniciar após a conclusão ou trocar de modo inicia uma nova contagem. O histórico de tentativas permanece: uma ação sem confirmação não é repetida automaticamente no mesmo perfil e modo, nem é somada à meta. Ao reiniciar o serviço, as sessões ficam paradas. Verificações usam a mesma resolução manual do aquecimento.

## Dicas

- Em computadores mais fracos, instale com `npm run instalar -- --whisper=base` para deixar a transcrição mais leve.
- Para atualizar, rode `git pull` e depois `npm run instalar` dentro da pasta do projeto.
- Se algo não funcionar, rode `cortes-eb doctor` para ver o que está faltando.

<details>
<summary><b>Detalhes técnicos</b></summary>

<br>

Tudo fica na pasta `.cortes-eb` dentro do seu usuário (`~/.cortes-eb` no Linux, `%USERPROFILE%\.cortes-eb` no Windows). Para mudar o local, defina a variável `CORTES_EB_HOME`.

| Componente  | Como roda                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Banco       | Um arquivo SQLite (`cortes.db`), criado e atualizado sozinho. Não precisa instalar nem configurar banco |
| Clipes      | Pasta `library`, separados por dia                                                                      |
| IA local    | Ollama como serviço em `127.0.0.1:11434`, com o modelo `qwen2.5:3b-instruct` (cerca de 2 GB)            |
| Transcrição | whisper.cpp, com o modelo `small` por padrão                                                            |
| Vídeo       | FFmpeg e yt-dlp na pasta `bin`, sem mexer no resto do sistema                                           |
| Painel      | Servidor local em `127.0.0.1`, acessível só pelo seu computador                                         |
| Chaves      | Criptografadas com AES-256-GCM e uma chave mestra (`master.key`) que só o seu usuário lê                |

Nada sai da sua máquina, a não ser que você escolha uma IA externa (chave de API, Claude Code ou Codex).

</details>

## Demonstração

https://github.com/user-attachments/assets/a58886c1-98b8-42c6-a36a-160225bd34a0

---

<div align="center">

Feito por [Ebkzim](https://github.com/Ebkzim) · [Licença MIT](LICENSE) · [Segurança](SECURITY.md)

</div>
