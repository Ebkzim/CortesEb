# Nicho: gameplay

Cortes de lives e vídeos de qualquer jogo.

## Metade de baixo

Se a origem já é a tela do jogo com a câmera num canto, use `crop` na câmera e `bottom: source` com `bottomCrop` na área do jogo: a gameplay aparece embaixo, sincronizada com a fala, e nenhum vídeo extra é necessário. Se a origem é só a pessoa falando, peça ao usuário uma gameplay do mesmo jogo, de preferência sem interface cobrindo a tela.

## O que rende gancho

- Reação a um momento inesperado: morte, vitória no limite, bug.
- Dica ou segredo que muda o jeito de jogar.
- Comparação com outro jogo ou com a versão anterior.
- Reclamação ou elogio forte sobre uma mecânica.
- Número: horas jogadas, recorde, dano, preço.

## Imagens

Capa do jogo na primeira menção, item ou personagem quando citado, e a logo do estúdio quando ele entra na conversa.

## Viradas

Marque em `turns` o instante da reação e a troca de assunto.

## Cuidados

- Em live, música e som do jogo impedem a remoção de pausas. É esperado.
- Reação sem a causa visível não funciona. Confira com `cortes-eb frame` se o que provocou a reação aparece ou é explicado na fala.
- Evite spoiler de história sem avisar o usuário.
