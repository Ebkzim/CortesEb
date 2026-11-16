# Problemas comuns

| Sintoma                            | Causa provável                             | O que fazer                                                                                                                   |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `ffmpeg: false` no `doctor`        | FFmpeg fora do PATH                        | Linux: `sudo apt install ffmpeg`. macOS: `brew install ffmpeg`. Windows: `winget install Gyan.FFmpeg`. Abra um terminal novo. |
| `ytdlp: false`                     | yt-dlp não instalado                       | Linux: `pipx install yt-dlp`. macOS: `brew install yt-dlp`. Windows: `winget install yt-dlp`. Sem ele, só arquivo.            |
| `erro: só aceito links https`      | Link `http`, local ou com usuário e senha  | Peça um link `https` público ou o arquivo.                                                                                    |
| Download falha com HTTP 429        | O site limitou as requisições              | Espere alguns minutos. Se continuar, peça o arquivo.                                                                          |
| Download pede confirmação de idade | Vídeo com restrição                        | Peça o arquivo. Não use cookies do navegador.                                                                                 |
| `erro: modelo ... não instalado`   | Falta o whisper.cpp ou o modelo            | Rode `cortes-eb setup`.                                                                                                       |
| O setup não compila o whisper.cpp  | Faltam ferramentas de compilação           | Linux: `sudo apt install build-essential`. macOS: `xcode-select --install`.                                                   |
| As pausas não saíram               | Música ou som de jogo por baixo da fala    | É esperado em live e react. Hesitações e "é..." não são removidos.                                                            |
| Legenda com erros                  | Modelo pequeno para o áudio                | `cortes-eb config --model medium`, `cortes-eb setup` e transcreva de novo.                                                    |
| Legenda fora de sincronia          | Vídeo com taxa de quadros variável         | Converta antes: `ffmpeg -i ARQ -vf fps=30 -c:a aac novo.mp4` e importe o novo.                                                |
| Rosto cortado                      | Pessoa fora do centro                      | Ajuste `focus` ou use `crop`.                                                                                                 |
| Câmera borrada                     | Câmera pequena ampliada                    | Use uma origem com a pessoa em plano grande ou em resolução maior.                                                            |
| `erro: cuts.json inválido (...)`   | Campo fora da regra                        | A mensagem aponta o campo. Corrija e renderize de novo.                                                                       |
| `erro: nenhuma conta cadastrada`   | Falta cadastrar uma conta                  | Rode `cortes-eb account add <id> --name ... --logo ...`.                                                                      |
| `erro: conta desconhecida`         | Id errado no `--account` ou no `cuts.json` | Confira os ids com `cortes-eb account list`.                                                                                  |
| Imagem pulada em `warnings`        | Sem chaves do Google ou imagem inválida    | Envie a imagem como `file` ou siga sem ela.                                                                                   |
| Corte sem voz                      | O arquivo de origem não tem áudio          | Confira com `ffprobe -show_streams work/source.mp4`.                                                                          |
| Render lento                       | O render roda na máquina do usuário        | É esperado. O primeiro render também baixa o navegador.                                                                       |
