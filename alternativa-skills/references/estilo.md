# Estilo dos cortes

O visual de referência vem dos componentes em `remotion/` e dos valores em `remotion/theme.ts`. O motor rápido (`--engine fast`) reproduz o mesmo layout direto no ffmpeg: a legenda é desenhada em ASS com a mesma fonte e tamanho, e a marca d'água e o degradê viram imagens sobrepostas. Diferenças conhecidas: o espaço entre as linhas da legenda é um pouco maior, e a imagem pop não tem cantos arredondados nem animação de escala (só o fade).

## Quadro (1080×1920, 30 fps)

| Região                          | Conteúdo                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metade de cima (0 a 960 px)     | Vídeo de origem, preenchendo a área. `focus` define o ponto que fica centralizado. `crop` amplia uma região específica.                                                          |
| Metade de baixo (960 a 1920 px) | Com `bottom: video`, o segundo vídeo, sem áudio, em loop se for mais curto que o corte. Com `bottom: source`, o próprio vídeo de origem, com os mesmos cortes da metade de cima. |
| Divisa (y = 960)                | Faixa escura em degradê de 340 px com a legenda por cima.                                                                                                                        |
| Canto superior direito          | Marca d'água: logo em círculo e nome da conta.                                                                                                                                   |

## Legenda

- De 1 a 3 palavras por vez, até cerca de 20 caracteres.
- Troca de página em pausa maior que 0,6 s e em fim de frase.
- Caixa alta, Montserrat Black 96 px, branca com contorno preto.
- A palavra falada no momento fica amarela.
- Vírgula, ponto e vírgula e dois pontos no fim da palavra não aparecem.

## Cortes e ritmo

- Silêncio acima de 0,5 s é removido, deixando 0,12 s de respiro em cada ponta.
- Com `pace: jump`, planos longos são quebrados a cada ~2,8 s, sempre no começo de uma palavra. Nenhum conteúdo é removido.
- Zoom por plano: o primeiro entra em 112% e assenta em 100% em 9 quadros. Os planos ímpares entram em 106%. Os pares ficam em 100%.
- Flash branco curto só nos pontos de `turns` (ou em todo corte com `pace: flash`).
- O áudio do corte é a fala do vídeo de origem.

## Imagens

Entram na metade de baixo com escala de 90% a 100% e fade, com borda branca e cantos arredondados. Duração padrão de 2,2 s.

## Som

- `impact` no primeiro quadro.
- `whoosh` 0,08 s antes de cada virada.
- `pop` 0,05 s antes de cada imagem.
- O volume geral vem de `sfxGain` (padrão 0,6). Para mudar: `cortes-eb config --sfx-gain 0.4`.

## Ajustes que o usuário pode pedir

| Pedido                   | O que fazer                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| Enquadrar o rosto        | Ajuste `focus` no `cuts.json` depois de olhar um quadro com `cortes-eb frame`.    |
| Câmera pequena numa live | Use `crop` em volta de quem fala. Avise que a imagem ampliada perde nitidez.      |
| Outro vídeo embaixo      | Rode `cortes-eb fetch ... --role bottom` e renderize de novo.                     |
| Menos cortes secos       | Use `pace: steady` ou aumente `cutEvery`.                                         |
| Legenda mais precisa     | `cortes-eb config --model medium`, depois `cortes-eb setup` e transcreva de novo. |
