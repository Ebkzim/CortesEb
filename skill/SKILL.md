---
name: cortes-eb
description: Transforma um vídeo longo (link ou arquivo) de streamer, gameplay, podcast, filme ou série em vários cortes verticais para Shorts, cada um com um assunto e um gancho próprios, em tela dividida, com legenda palavra por palavra, pausas removidas, jump cuts com zoom e a marca d'água da conta. Suporta várias contas, cada uma com seu nome e logo. Tem um nicho especial de GTA 6. Use com /cortes-eb ou quando o usuário pedir cortes, "cortar esse vídeo" ou "fazer shorts desse vídeo".
---

# cortes-eb

Você recebe um vídeo longo e entrega vários cortes prontos em 9:16 (1080×1920, 30 fps). Você escolhe os trechos lendo a transcrição. Tudo roda na máquina do usuário pelo comando `cortes-eb`.

Fale pouco no chat. Nunca cole a transcrição nem um JSON inteiro. Mostre só o que o usuário precisa decidir ou receber.

Todo comando imprime JSON na saída padrão e mensagens de progresso na saída de erro. Se um comando falhar, ele imprime `erro: <motivo>` e sai com código 1.

## 0. Conferir a instalação

```bash
cortes-eb doctor
```

| Campo               | Se for `false` ou `0`                                   |
| ------------------- | ------------------------------------------------------- |
| `ffmpeg`, `ffprobe` | Peça para o usuário instalar o FFmpeg e pare.           |
| `whisper`           | Avise que o download é grande e rode `cortes-eb setup`. |
| `ytdlp`             | Aceite só arquivo de vídeo, não link.                   |
| `accounts`          | Opcional. Veja o passo 1.                               |
| `sfx`               | Opcional. Veja "Efeitos sonoros".                       |
| `googleImages`      | Opcional. Veja "Imagens".                               |

Quando faltar algo opcional, avise uma vez, em poucas linhas, com as opções. Não pare o trabalho por isso e não pergunte de novo na mesma conversa.

## 1. Contas (opcional)

Uma conta é um destino para os cortes: um id curto (minúsculas, números e hífen) e, se o usuário quiser, um nome (pode ser o @) e uma logo (PNG, JPG ou WebP) para a marca d'água. Nome e logo são opcionais e independentes:

| A conta tem     | Marca d'água no corte                                          |
| --------------- | -------------------------------------------------------------- |
| Nome e logo     | Logo em círculo com o nome ao lado, no canto superior direito. |
| Só nome         | Só o nome.                                                     |
| Só logo         | Só a logo.                                                     |
| Nenhum dos dois | Nenhuma.                                                       |

```bash
cortes-eb account add gta --name "@canalgta" --logo "/caminho/da/logo.png"
cortes-eb account add games
cortes-eb account add gta --clear-logo
cortes-eb account list
cortes-eb account default gta
cortes-eb account remove gta
```

`account add` com um id que já existe atualiza só o que for passado. `--clear-name` e `--clear-logo` removem um item. A primeira conta cadastrada vira a padrão.

Não exija nome nem logo. Se `accounts` vier vazio, pergunte uma vez se o usuário quer cadastrar contas ou seguir sem marca d'água. Sem nenhuma conta, o render sai direto na pasta de saída, sem marca d'água.

Se houver mais de uma conta, pergunte para quais contas os cortes vão antes de renderizar, a menos que o usuário já tenha dito. Ele pode mandar todos os cortes para as mesmas contas ou escolher por corte.

## 2. Nicho

O nicho define o guia de ganchos e o vídeo sugerido para a metade de baixo. O padrão está em `niche` no `doctor`.

```bash
cortes-eb niches
cortes-eb niches gta6
```

Escolha o nicho pelo conteúdo do vídeo e leia o guia dele em `niches/<id>.md` antes de escolher os cortes. Se o usuário disser o nicho, use o dele. Para trocar o padrão: `cortes-eb config --niche <id>`.

## 3. Pedir os vídeos

Peça o vídeo de origem (link ou arquivo). Na mesma mensagem, ofereça escolher o vídeo da metade de baixo. Se o usuário não tiver um, use o `defaultBottomUrl` do nicho. Se o nicho não tiver padrão, peça um seguindo o `bottomHint`.

## 4. Preparar a pasta de trabalho

Use `./cortes/<slug>/work` na pasta atual, com `<slug>` em minúsculas e com hífen.

```bash
cortes-eb fetch "LINK_OU_ARQUIVO" --work cortes/<slug>/work
cortes-eb fetch "LINK_OU_ARQUIVO" --work cortes/<slug>/work --role bottom
```

Só links `https` são aceitos. Se o download falhar por limite de requisições, espere e tente de novo. Se o vídeo tiver restrição de idade, peça o arquivo. Nunca use os cookies do navegador do usuário.

## 5. Plano: quantidade e duração

O usuário pode definir a duração dos cortes, a quantidade, os dois ou nenhum. Rode `plan` sempre, logo depois de baixar o vídeo de origem:

```bash
cortes-eb plan --work cortes/<slug>/work --min-seconds 30 --max-seconds 45
cortes-eb plan --work cortes/<slug>/work --count 8
cortes-eb plan --work cortes/<slug>/work --count 8 --min-seconds 30 --max-seconds 45
cortes-eb plan --work cortes/<slug>/work
```

| O usuário informou | O que o plano calcula                               |
| ------------------ | --------------------------------------------------- |
| Faixa de duração   | A quantidade, pelo tamanho do vídeo.                |
| Quantidade         | A faixa de duração, pelo tamanho do vídeo.          |
| Os dois            | Nada. Só confere se cabe no vídeo.                  |
| Nenhum             | 20 a 60 s e de 1 a 5 cortes, pelo tamanho do vídeo. |

Se ele der só o mínimo ou só o máximo, o outro lado da faixa é calculado. A saída traz `count`, `minSeconds` e `maxSeconds`: diga esses três números ao usuário em uma linha antes de seguir. A duração vale para o corte pronto, já sem as pausas. Os limites são 10 a 180 s por corte e até 20 cortes.

Se o pedido não couber no vídeo, o comando explica quantos cortes cabem. Repasse isso ao usuário e peça o ajuste.

Pergunte a duração ou a quantidade junto com o pedido dos vídeos, numa única mensagem, deixando claro que é opcional.

## 6. Transcrever

Para escolher os cortes você precisa de uma transcrição com tempo. Há dois caminhos, e o primeiro é muito mais rápido:

**Vídeo de link com legenda automática (padrão para links).** Leva cerca de 1 minuto, contra uns 30 minutos do whisper para um vídeo de meia hora:

```bash
cortes-eb captions --work cortes/<slug>/work --lang pt
```

Se o vídeo não tiver legenda no idioma, o comando avisa. Aí use o whisper.

**Whisper (arquivo, ou link sem legenda).** Transcreve tudo localmente e é lento:

```bash
cortes-eb transcribe --work cortes/<slug>/work --lang pt
```

`--max-seconds N` transcreve só o começo. Para refazer só um trecho: `--from N --to M`.

Depois, leia a transcrição:

```bash
cortes-eb transcript --work cortes/<slug>/work
```

Ela imprime linhas `[mm:ss] frase`. Leia em blocos.

A legenda do YouTube serve para **escolher** os cortes. Ela é menos precisa que o whisper nas palavras. Por isso, depois de gravar o `cuts.json` (passo 7), rode o `refine`, que retranscreve com o whisper só os trechos escolhidos:

```bash
cortes-eb refine --work cortes/<slug>/work
```

Leva alguns minutos, e não a transcrição inteira.

## Vídeos longos (lives, VODs da Twitch e da Kick)

Uma live de horas não pode ser transcrita inteira: o whisper leva de 1 a 6 minutos por minuto de fala. Para vídeos acima de uns 40 minutos, não baixe nem transcreva tudo.

1. Baixe só um trecho de cada vez, com o ponto de início e de fim em segundos. O trecho vira o `source.mp4`, e o tempo dentro dele começa em zero. O início fica registrado em `origin.json` (campo `offset`):

```bash
cortes-eb fetch "LINK" --work cortes/<slug>/work --from 3600 --to 5400
```

2. Se o usuário não souber onde estão os bons momentos, varra o trecho baixado atrás de picos de volume (gritos, risadas, reações), sem transcrever nada. Leva cerca de 30 segundos para meia hora de vídeo:

```bash
cortes-eb peaks --work cortes/<slug>/work --top 10
```

A saída lista janelas com início, fim, ponto do pico e nota. **Os picos são só uma pista.** Eles pegam som alto de qualquer origem, inclusive o do jogo, e perdem comentários calmos mas interessantes. Em vídeos de react, metade dos picos pode ser áudio do jogo.

3. Transcreva com o whisper só as janelas que parecerem promissoras:

```bash
cortes-eb transcribe --work cortes/<slug>/work --lang pt --from 562 --to 595
```

Funciona numa pasta nova e acumula as janelas já transcritas. Leia com `cortes-eb transcript`.

4. Escolha os cortes sobre essas janelas, como no passo 7.

Links da Twitch e da Kick (VODs e clipes) são aceitos, mas não foram testados. Esses sites não têm legenda automática, então não use `captions`. VODs só para inscritos e lives em andamento não funcionam.

## Live em andamento

Para acompanhar uma live ao vivo e gerar cortes enquanto ela acontece:

```bash
cortes-eb live "LINK_DA_LIVE" --account all --model base
```

Em lives da Twitch o comando também lê o chat (de forma anônima, só leitura) e soma ao volume: quando o chat passa de 2 a 3 vezes o ritmo dos últimos 5 minutos, o momento vira candidato. Use `--no-chat` para desligar. Na YouTube e na Kick só o áudio conta.

Se não souber o idioma da live, use `--lang auto` e o whisper detecta sozinho. Vale também para `transcribe` e para `config --language auto`; a legenda automática do YouTube continua pedindo um idioma explícito.

O comando fica rodando até a live acabar ou até o usuário parar (Ctrl+C). Rode em segundo plano e acompanhe a saída: cada linha é um JSON com `event` igual a `start`, `clip`, `skip`, `error` ou `end`. Um evento `clip` traz `files` (os vídeos prontos), `hook` e `afterPeakSeconds` (atraso entre o pico e o arquivo pronto).

Como funciona: a live é gravada em pedaços de 3 s sem recodificar, o volume do áudio é medido em tempo real e, quando a empolgação passa do normal, o corte é montado a partir dos pedaços, transcrito, ajustado para começar e terminar em pausas de fala e renderizado. Cortes com pouca fala (só música ou barulho do jogo) são descartados com `skip`.

| Opção            | Efeito                                                        |
| ---------------- | ------------------------------------------------------------- |
| `--account`      | Contas que recebem os cortes (como no `render`).              |
| `--bottom`       | Vídeo da metade de baixo, ou `none` para usar a própria live. |
| `--model`        | Modelo do whisper. `tiny` e `base` são bem mais rápidos.      |
| `--threshold`    | Quanto acima do volume normal conta como pico (padrão 6 dB).  |
| `--max-per-hour` | Teto de cortes por hora (padrão 12).                          |
| `--max-clips`    | Para depois de n cortes (0 = sem limite).                     |
| `--queue`        | Cortes esperando render; se encher, descarta o de menor nota. |
| `--offline-wait` | Quanto esperar a live voltar se cair (padrão 120 s).          |

### Câmera do streamer

Por padrão o topo do corte é o centro da live. Para mostrar o rosto do streamer, descubra onde a câmera fica:

```bash
cortes-eb live-frame "LINK_DA_LIVE" --out live-frame.jpg
```

Olhe a imagem (evite pegar um intervalo comercial) e rode o `live` com `--camera`:

- um canto: `--camera bottom-left` (ou `top-left`, `top-right`, `bottom-right`), com `--camera-size 40` para a altura da câmera em % do quadro;
- um retângulo exato, em % do quadro: `--camera 0,60,25,40` (x, y, largura, altura).

Com câmera no topo e sem `--bottom`, a metade de baixo mostra a própria live (o jogo).

O atraso depende do computador, porque a transcrição é a parte mais lenta. Num processador fraco, `--model tiny` ou `base` leva alguns minutos por corte. Num desktop mais forte, o `small` já fica na casa de dezenas de segundos. Avise o usuário disso antes de começar.

A escolha do momento é automática (volume e quantidade de fala), então a qualidade é menor que a de um corte escolhido lendo a transcrição. Os cortes ficam em `--out` (padrão `cortes/live-<data>`), uma subpasta por conta.

## 7. Escolher os cortes

O usuário não escolhe os trechos. Você decide, seguindo `references/ganchos.md` e o guia do nicho.

1. Mapeie os assuntos do vídeo e anote o minuto de cada bloco.
2. Escolha exatamente `count` cortes, cada um com duração final entre `minSeconds` e `maxSeconds`, de assuntos diferentes e sem sobreposição de tempo.
3. Comece cada corte na frase de gancho e termine na frase que entrega a resposta.
4. Dê nota de 0 a 10 a cada gancho. Se não houver `count` ganchos com nota 6 ou mais, diga ao usuário quantos bons existem e pergunte se ele prefere menos cortes ou aceitar os mais fracos. Para reduzir, rode `plan` de novo com `--count`.
5. Confira o enquadramento com `cortes-eb frame --work cortes/<slug>/work --at 5`, olhe a imagem gerada e ajuste `focus`.
6. Grave `work/cuts.json`.
7. Rode `cortes-eb refine --work cortes/<slug>/work` se a transcrição veio da legenda do YouTube, e depois `cortes-eb check --work cortes/<slug>/work`. O `check` mostra a duração final de cada corte e o que está fora do plano, sem renderizar. Ajuste `start` e `end` até `ok` ser `true`. Como as pausas saem, o corte pronto fica mais curto que `end - start`.

```json
{
  "clips": [
    {
      "id": "01-tamanho-do-mapa",
      "start": 312.4,
      "end": 358.0,
      "focus": { "x": 50, "y": 35 },
      "topic": "tamanho do mapa",
      "hook": "O mapa novo é a soma de três mapas.",
      "score": 8,
      "title": "O mapa é três vezes maior",
      "turns": [331.0],
      "images": [{ "file": "/caminho/mapa.png", "at": 318.0, "dur": 2.2 }]
    }
  ]
}
```

| Campo                             | Regra                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                              | Obrigatório. Minúsculas, números e hífen, até 64 caracteres. Vira o nome do arquivo.                                                      |
| `start`, `end`                    | Obrigatórios, em segundos do vídeo de origem.                                                                                             |
| `focus`                           | `x` e `y` de 0 a 100. Posiciona o rosto na metade de cima. Padrão `50, 35`.                                                               |
| `crop`                            | `{x, y, w, h}` em pixels do vídeo de origem. Use quando a câmera de quem fala é pequena no quadro. Proporção perto de 1,125:1.            |
| `pace`                            | `jump` (padrão): jump cut seco a cada ~2,8 s. `steady`: só remove pausas. `flash`: flash e whoosh em todo corte.                          |
| `cutEvery`                        | Intervalo dos jump cuts em segundos.                                                                                                      |
| `turns`                           | Segundos em que o assunto vira. Só nesses pontos entram flash e whoosh. De 3 a 5 por corte.                                               |
| `images`                          | Até 10. Cada uma com `file` ou `query`, `at` em segundos do vídeo de origem e `dur` opcional.                                             |
| `bottom`                          | `video` (padrão): a metade de baixo mostra o `bottom.mp4`. `source`: mostra o próprio vídeo de origem, sincronizado com a fala.           |
| `bottomCrop`                      | Só com `bottom: source`. `{x, y, w, h}` em pixels do vídeo de origem, com a região que aparece embaixo. Sem ele, o quadro é centralizado. |
| `bottomStart`                     | Só com `bottom: video`. Segundo em que o vídeo de baixo começa.                                                                           |
| `accounts`                        | Opcional. Ids das contas que recebem este corte. Sem ele, valem as contas do `--account` do render.                                       |
| `topic`, `hook`, `score`, `title` | Texto de apoio para a entrega.                                                                                                            |

### React e gameplay com câmera pequena

Quando a origem é a tela do jogo ou de um vídeo com a câmera de quem fala num canto, o que a pessoa comenta precisa aparecer. Use `crop` na câmera para a metade de cima e `bottom: source` com `bottomCrop` na área do jogo para a metade de baixo:

```json
{
  "crop": { "x": 12, "y": 30, "w": 340, "h": 302 },
  "bottom": "source",
  "bottomCrop": { "x": 360, "y": 0, "w": 1215, "h": 1080 }
}
```

Meça os pixels num quadro extraído com `cortes-eb frame`. As duas regiões devem ter proporção perto de 1,125:1. Se todos os cortes usarem `bottom: source`, o vídeo de baixo não é necessário e não precisa ser pedido nem baixado.

Campos desconhecidos são recusados. Detalhes do visual em `references/estilo.md`.

## Imagens

Use imagem real quando a fala cita algo mostrável: capa, logo, mapa, personagem, console. `file` usa uma imagem do usuário. `query` busca no Google pela API oficial e precisa das variáveis `GOOGLE_API_KEY` e `GOOGLE_CSE_ID`. Sem elas, a imagem é pulada e o aviso aparece em `warnings`. Não tente raspar a busca do Google pelo navegador.

## Efeitos sonoros

Os efeitos `impact`, `whoosh` e `pop` ficam na pasta `sfx` dentro de `home` (veja o `doctor`), em mp3 ou wav. O render usa o que existir: impacto no início, whoosh nas viradas e pop em cada imagem.

Se `sfx` for `0`, ofereça uma vez: gerar com a ElevenLabs (gasta créditos da conta do usuário e precisa de `ELEVENLABS_API_KEY`), colocar arquivos próprios na pasta ou seguir sem efeitos. Só com o aceite:

```bash
cortes-eb sfx
```

Nunca peça nem escreva uma chave de API no chat.

## 8. Renderizar

```bash
cortes-eb render --work cortes/<slug>/work --out cortes/<slug> --account gta,filmes
```

`--engine fast` (padrão) monta o vídeo direto no ffmpeg e leva uns 2 minutos para um corte de 70 s. `--engine remotion` usa o navegador do Remotion, com o visual de referência, e leva uns 13 minutos para o mesmo corte. Use o rápido sempre, a menos que o usuário peça o outro.

`--account` aceita ids separados por vírgula ou `all`. Sem ele, vale a conta padrão. Um corte com `accounts` no `cuts.json` ignora o `--account`. Cada conta recebe os arquivos em `cortes/<slug>/<conta>/`. Sem nenhuma conta cadastrada, os arquivos saem em `cortes/<slug>/`, sem marca d'água. Um corte enviado a duas contas é renderizado duas vezes, uma com cada marca d'água.

O render recusa um `cuts.json` fora do plano. A saída lista cada corte por conta com `account`, `ok`, `seconds`, `warnings` e `error`. Se um corte falhar, mostre o erro e entregue os outros.

## 9. Entregar

Responda curto: os arquivos gerados por conta e uma tabela com assunto, gancho, duração, nota e título sugerido de cada corte.

## Regras

- Cada execução é independente. Não reaproveite o `cuts.json` de outro vídeo.
- A legenda é o que a pessoa falou. Não invente texto nem mude o sentido.
- Não mude o nome nem a logo de uma conta sem o usuário pedir.
- Se algo falhar, veja `references/problemas.md`.
