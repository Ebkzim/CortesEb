import type { ClipTargets } from '../planning/clip-targets.js';

export interface AgentPromptInput {
  agent: 'claude' | 'codex';
  workDir: string;
  targets: Pick<ClipTargets, 'count' | 'minSeconds' | 'maxSeconds'>;
  preset: string;
  niche: string;
}

export function buildAgentPrompt(input: AgentPromptInput): string {
  const { workDir, targets } = input;
  const intro =
    input.agent === 'claude'
      ? 'Use a skill cortes-eb para escolher os cortes deste vídeo. Faça só a escolha: não baixe, não transcreva de novo e não renderize.'
      : 'Escolha os cortes deste vídeo usando o comando cortes-eb no terminal. Faça só a escolha: não baixe, não transcreva de novo e não renderize.';
  return [
    intro,
    '',
    `Pasta de trabalho: ${workDir}`,
    `Tipo de corte: ${input.preset} (nicho ${input.niche})`,
    `Quantidade: ${String(targets.count)} ${targets.count === 1 ? 'corte' : 'cortes'}, cada um entre ${String(targets.minSeconds)} e ${String(targets.maxSeconds)} segundos.`,
    '',
    'Passos:',
    `1. Leia a transcrição: cortes-eb transcript --work "${workDir}"`,
    '2. Escolha os trechos com os melhores ganchos: o corte começa na frase que prende quem rola o feed e termina quando o raciocínio fecha. Cada corte de um assunto diferente, sem sobreposição. Nunca invente falas.',
    `3. Grave o arquivo ${workDir}/cuts.json neste formato:`,
    '   {"clips":[{"id":"01-titulo-curto","start":12.3,"end":48.9,"hook":"primeira frase","title":"Título curto","score":8}]}',
    '   O id usa só letras minúsculas, números e hífen. start e end são segundos do vídeo.',
    `4. Confira: cortes-eb check --work "${workDir}" e corrija até aparecer "ok": true.`,
    '',
    'Não mexa no layout nem renderize: o painel continua sozinho assim que o cuts.json estiver válido.',
  ].join('\n');
}
