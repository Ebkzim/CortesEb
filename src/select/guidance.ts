import fs from 'node:fs/promises';

export const CORE_RULES = [
  'Um bom corte começa numa frase que prende quem está rolando o feed e termina quando o raciocínio fecha.',
  'Vale mais: dado concreto, número, nome, surpresa, discordância, veredito forte ou reação intensa.',
  'Descarte: saudação, abertura do vídeo, pedido de inscrição ou like, propaganda, patrocínio, link na descrição, conversa enrolada e trecho que depende do que veio antes.',
  'Nunca invente fala. Cada corte de um assunto diferente.',
].join('\n');

export const PRESET_HINTS: Record<string, string> = {
  'gameplay-camera':
    'É uma live de gameplay com a câmera do jogador. Os melhores cortes são reações fortes ao que acontece no jogo, jogadas marcantes e comentários engraçados ou opiniões fortes sobre o jogo.',
  'gta6-gameplay':
    'É uma gameplay de GTA 6 comentada. Os melhores cortes mostram detalhes novos do jogo, comparações com GTA 5 e descobertas ou opiniões fortes.',
  'gta6-react':
    'É um streamer reagindo a um trailer ou vídeo de GTA 6. O começo costuma ser ele falando sozinho antes de o vídeo começar: ignore essa abertura. Os melhores cortes são os momentos em que ele reage ao que aparece na tela: nota um detalhe, se surpreende, compara com outro GTA ou dá uma opinião forte.',
  filmes:
    'É alguém reagindo ou comentando um filme. O começo costuma ser a pessoa falando sozinha antes de a cena começar: ignore essa abertura. Os melhores cortes são reações fortes, vereditos, teorias e detalhes que passaram despercebidos.',
  series:
    'É alguém reagindo ou comentando uma série. O começo costuma ser a pessoa falando sozinha antes do episódio: ignore essa abertura. Os melhores cortes são reações fortes, vereditos, teorias e detalhes que passaram despercebidos.',
  'filmes-cena':
    'São cenas de um filme, sem ninguém comentando. Os melhores cortes são falas marcantes, piadas, duplo sentido, humor ácido ou humor negro, frases de efeito, tensão e reviravolta. O corte precisa fazer sentido sozinho para quem nunca viu o filme e terminar na frase de impacto ou na risada.',
  'series-cena':
    'São cenas de uma série, sem ninguém comentando. Os melhores cortes são falas marcantes, piadas, duplo sentido, humor ácido ou humor negro, frases de efeito, discussões, tensão e reviravolta. O corte precisa fazer sentido sozinho para quem nunca viu a série e terminar na frase de impacto ou na risada.',
  podcast:
    'É uma conversa entre pessoas. Os melhores cortes são histórias completas, opiniões polêmicas, revelações e respostas marcantes.',
};

const SECTIONS = ['O que rende gancho', 'Cuidados'];
const MAX_GUIDE_CHARS = 1400;

export function extractGuide(markdown: string): string {
  const lines: string[] = [];
  let keep = false;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading?.[1] !== undefined) {
      keep = SECTIONS.includes(heading[1].trim());
      continue;
    }
    if (keep && line.trim().startsWith('- ')) lines.push(line.trim().replace(/`/g, ''));
  }
  return lines.join('\n').slice(0, MAX_GUIDE_CHARS);
}

export async function buildGuidance(preset: string, nicheFile: string | null): Promise<string> {
  const guide =
    nicheFile === null ? '' : extractGuide(await fs.readFile(nicheFile, 'utf8').catch(() => ''));
  return [PRESET_HINTS[preset] ?? '', CORE_RULES, guide === '' ? '' : `Guia do nicho:\n${guide}`]
    .filter((part) => part !== '')
    .join('\n\n');
}

export function introSeconds(preset: string, duration: number): number {
  const react = preset === 'gta6-react' || preset === 'filmes' || preset === 'series';
  const share = react ? 0.08 : 0.04;
  const floor = react ? 45 : 15;
  const ceiling = react ? 180 : 60;
  return Math.round(Math.min(ceiling, Math.max(floor, duration * share), duration * 0.25));
}
