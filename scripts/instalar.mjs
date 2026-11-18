#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WINDOWS = process.platform === 'win32';
const ARM = process.arch === 'arm64';
const HOME = path.resolve(
  process.env.CORTES_EB_HOME?.trim() || path.join(os.homedir(), '.cortes-eb'),
);
const BIN = path.join(HOME, 'bin');
const EXE = WINDOWS ? '.exe' : '';
const MIN_NODE = [22, 12];
const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:3b-instruct';
const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v3'];

const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';
const GYAN = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const FFMPEG = WINDOWS
  ? [
      { url: `${BTBN}/ffmpeg-master-latest-win64-gpl.zip`, sums: `${BTBN}/checksums.sha256` },
      { url: GYAN, sums: `${GYAN}.sha256` },
    ]
  : [
      {
        url: `${BTBN}/ffmpeg-master-latest-${ARM ? 'linuxarm64' : 'linux64'}-gpl.tar.xz`,
        sums: `${BTBN}/checksums.sha256`,
      },
    ];

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const YTDLP = {
  url: `${YTDLP_RELEASE}/${WINDOWS ? 'yt-dlp.exe' : ARM ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'}`,
  sums: `${YTDLP_RELEASE}/SHA2-256SUMS`,
};

const OLLAMA_RELEASE = 'https://github.com/ollama/ollama/releases/latest/download';
const OLLAMA_SETUP = {
  url: `${OLLAMA_RELEASE}/OllamaSetup.exe`,
  sums: `${OLLAMA_RELEASE}/sha256sum.txt`,
};
const OLLAMA_SCRIPT = 'https://ollama.com/install.sh';

const options = parseArgs(process.argv.slice(2));
const report = [];

async function main() {
  if (options.help) {
    printHelp();
    return;
  }
  title('CortesEb: instalação');
  info(`pasta de dados: ${HOME}`);
  checkPlatform();
  checkNode();
  await fs.mkdir(BIN, { recursive: true });
  process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH ?? ''}`;

  await step('dependências do projeto', async () => {
    npm(['ci', '--no-audit', '--no-fund'], ROOT);
    npm(['ci', '--no-audit', '--no-fund'], path.join(ROOT, 'web'));
  });
  await step('compilando o sistema e o painel', async () => {
    npm(['run', 'build'], ROOT);
    npm(['run', 'build'], path.join(ROOT, 'web'));
  });
  await step('FFmpeg', installFfmpeg);
  await step('yt-dlp (downloads de links)', installYtdlp);
  await step('banco de dados', async () => {
    run(process.execPath, [path.join(ROOT, 'dist', 'main.js'), 'db', 'migrate'], ROOT);
  });
  await step('Whisper (transcrição) e navegador do render', installWhisper);
  if (options.ollama) {
    await step('Ollama (IA local)', installOllama, true);
    await step(`modelo de IA ${options.model}`, pullModel, true);
  } else {
    report.push(['Ollama (IA local)', 'pulado']);
  }
  await step('comando cortes-eb', linkCommand, true);
  await step('skill do Claude Code', linkSkill, true);

  title('Resumo');
  for (const [name, state] of report)
    info(
      `${state === 'ok' ? '✔' : state === 'pulado' ? '–' : '✖'} ${name}${state === 'ok' ? '' : `: ${state}`}`,
    );
  const failed = report.filter(([, state]) => state !== 'ok' && state !== 'pulado');
  console.log('');
  if (failed.length > 0) {
    info('Algumas etapas falharam. Corrija o que aparece acima e rode de novo: npm run instalar');
    process.exitCode = 1;
    return;
  }
  info('Tudo pronto. Para abrir o painel:');
  info(commandWorks() ? '   cortes-eb ui' : '   npm run painel');
}

function parseArgs(args) {
  const parsed = { ollama: true, model: DEFAULT_MODEL, whisper: null, help: false };
  for (const arg of args) {
    if (arg === '--sem-ollama') parsed.ollama = false;
    else if (arg.startsWith('--modelo='))
      parsed.model = arg.slice('--modelo='.length).trim() || DEFAULT_MODEL;
    else if (arg.startsWith('--whisper=')) parsed.whisper = arg.slice('--whisper='.length).trim();
    else if (arg === '--ajuda' || arg === '--help' || arg === '-h') parsed.help = true;
    else fail(`opção desconhecida: ${arg} (use --ajuda)`);
  }
  if (!/^[a-zA-Z0-9._:/-]{1,100}$/.test(parsed.model)) fail('nome de modelo inválido');
  if (parsed.whisper !== null && !WHISPER_MODELS.includes(parsed.whisper)) {
    fail(`modelo do Whisper inválido: use ${WHISPER_MODELS.join(', ')}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`uso: npm run instalar -- [opções]

  --sem-ollama        não instala o Ollama nem o modelo de IA local
  --modelo=NOME       modelo do Ollama (padrão ${DEFAULT_MODEL})
  --whisper=MODELO    modelo do Whisper: ${WHISPER_MODELS.join(', ')} (padrão small)
  --ajuda             mostra esta ajuda`);
}

function checkPlatform() {
  if (process.platform !== 'linux' && !WINDOWS) {
    fail('este instalador funciona no Linux e no Windows');
  }
  if (process.arch !== 'x64' && !(ARM && !WINDOWS)) {
    fail(`processador ${process.arch} não suportado (use x64, ou arm64 no Linux)`);
  }
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(
      `instale o Node.js ${MIN_NODE.join('.')} ou mais novo (você tem ${process.versions.node})`,
    );
  }
  info(`Node.js ${process.versions.node} ok`);
}

async function installFfmpeg() {
  if (has('ffmpeg') && has('ffprobe')) return 'já instalado';
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-ffmpeg-'));
  try {
    const archive = await downloadFirst(FFMPEG, work, WINDOWS ? 'ffmpeg.zip' : 'ffmpeg.tar.xz');
    const out = path.join(work, 'x');
    await fs.mkdir(out);
    run('tar', [WINDOWS ? '-xf' : '-xJf', archive, '-C', out], work);
    for (const name of ['ffmpeg', 'ffprobe']) {
      const found = await findFile(out, `${name}${EXE}`);
      if (found === null) throw new Error(`${name} não veio no pacote baixado`);
      await install(found, path.join(BIN, `${name}${EXE}`));
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
  if (!has('ffmpeg')) throw new Error('o FFmpeg baixado não executou nesta máquina');
  return 'ok';
}

async function installYtdlp() {
  if (has('yt-dlp')) {
    spawnSync('yt-dlp', ['-U'], { stdio: 'ignore', shell: false, timeout: 120_000 });
    return 'já instalado';
  }
  const target = path.join(BIN, `yt-dlp${EXE}`);
  await verifiedDownload(YTDLP, `${target}.part`);
  await fs.rename(`${target}.part`, target);
  if (!WINDOWS) await fs.chmod(target, 0o755);
  if (!has('yt-dlp')) throw new Error('o yt-dlp baixado não executou nesta máquina');
  return 'ok';
}

async function installWhisper() {
  if (!WINDOWS) {
    const missing = ['make', 'git'].filter((tool) => !has(tool));
    if (!has('g++') && !has('c++')) missing.push('g++');
    if (missing.length > 0 && !(await exists(path.join(HOME, 'whisper.cpp', 'main')))) {
      throw new Error(
        `faltam ${missing.join(', ')} para compilar o Whisper. No Ubuntu/Debian rode: sudo apt install build-essential git`,
      );
    }
  }
  const folder = path.join(HOME, 'whisper.cpp');
  if ((await exists(folder)) && !(await exists(path.join(folder, `main${EXE}`)))) {
    info('removendo uma instalação incompleta do Whisper');
    await fs.rm(folder, { recursive: true, force: true });
  }
  const cli = path.join(ROOT, 'dist', 'main.js');
  if (options.whisper !== null) run(process.execPath, [cli, 'config', '-m', options.whisper], ROOT);
  run(process.execPath, [cli, 'setup'], ROOT);
}

async function installOllama() {
  if (!(await ollamaExecutable())) {
    if (WINDOWS) {
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-ollama-'));
      try {
        const setup = path.join(work, 'OllamaSetup.exe');
        await verifiedDownload(OLLAMA_SETUP, setup);
        info('instalando o Ollama (pode aparecer uma janela do Windows pedindo permissão)');
        run(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], work);
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    } else {
      if (!has('curl')) throw new Error('instale o curl (sudo apt install curl) e rode de novo');
      info('o instalador oficial do Ollama vai pedir sua senha de administrador (sudo)');
      const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cortes-eb-ollama-'));
      try {
        const script = path.join(work, 'install.sh');
        await download(OLLAMA_SCRIPT, script);
        run('sh', [script], work);
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    }
  }
  const executable = await ollamaExecutable();
  if (executable === null) throw new Error('o Ollama não foi encontrado depois da instalação');
  if (!(await ollamaUp())) {
    const child = spawn(executable, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    for (let attempt = 0; attempt < 30 && !(await ollamaUp()); attempt += 1) await sleep(1000);
  }
  if (!(await ollamaUp()))
    throw new Error(
      'o Ollama foi instalado mas não respondeu; abra o app do Ollama e rode de novo',
    );
  return 'ok';
}

async function pullModel() {
  if (!(await ollamaUp())) throw new Error('o Ollama não está rodando');
  const tags = await (await fetch(`${OLLAMA_URL}/api/tags`)).json();
  if (tags.models?.some((model) => model.name === options.model)) return 'já instalado';
  const response = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: options.model, stream: true }),
  });
  if (!response.ok || response.body === null)
    throw new Error(`o Ollama recusou o download (${response.status})`);
  const progress = new Progress(`baixando ${options.model}`);
  let pending = '';
  for await (const chunk of response.body) {
    pending += Buffer.from(chunk).toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(event.error);
      if (event.total) progress.update(event.completed ?? 0, event.total);
    }
  }
  progress.done();
  return 'ok';
}

async function linkCommand() {
  if (commandWorks() && (await linkedHere())) return 'já instalado';
  const result = spawnSync(WINDOWS ? 'npm.cmd' : 'npm', ['link'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: WINDOWS,
  });
  if (result.status !== 0 || !commandWorks()) {
    throw new Error('não deu para criar o comando global; use "npm run painel" dentro desta pasta');
  }
  return 'ok';
}

async function linkSkill() {
  const claude = path.join(os.homedir(), '.claude');
  if (!(await exists(claude))) return 'pulado';
  const skills = path.join(claude, 'skills');
  const target = path.join(skills, 'cortes-eb');
  await fs.mkdir(skills, { recursive: true });
  const stat = await fs.lstat(target).catch(() => null);
  if (stat !== null && !stat.isSymbolicLink()) {
    info(`${target} já existe e não é um link; deixei como está`);
    return 'pulado';
  }
  if (stat !== null) await fs.rm(target, { force: true });
  await fs.symlink(path.join(ROOT, 'alternativa-skills'), target, WINDOWS ? 'junction' : 'dir');
  return 'ok';
}

async function step(name, work, optional = false) {
  title(name);
  try {
    const result = await work();
    report.push([
      name,
      result === undefined || result === 'já instalado'
        ? 'ok'
        : result === 'pulado'
          ? 'pulado'
          : 'ok',
    ]);
    if (result === 'já instalado') info('já instalado');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    info(`✖ ${message}`);
    report.push([name, message]);
    if (!optional && isCritical(name)) {
      title('Resumo');
      info(`a etapa "${name}" falhou e as próximas dependem dela`);
      process.exit(1);
    }
  }
}

function isCritical(name) {
  return name === 'dependências do projeto' || name === 'compilando o sistema e o painel';
}

function npm(args, cwd) {
  run(WINDOWS ? 'npm.cmd' : 'npm', args, cwd, WINDOWS);
}

function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell, windowsHide: true });
  if (result.error) throw new Error(`não consegui executar ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${path.basename(command)} ${args[0] ?? ''} terminou com erro (${result.status})`,
    );
}

function has(command) {
  const probe = spawnSync(
    command,
    command === 'yt-dlp' || command === 'ollama' ? ['--version'] : ['-version'],
    {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
      timeout: 30_000,
    },
  );
  if (probe.error === undefined && probe.status === 0) return true;
  if (['make', 'git', 'g++', 'c++', 'curl'].includes(command)) {
    const second = spawnSync(command, ['--version'], {
      stdio: 'ignore',
      shell: false,
      timeout: 30_000,
    });
    return second.error === undefined && second.status === 0;
  }
  return false;
}

function commandWorks() {
  const probe = spawnSync(WINDOWS ? 'cortes-eb.cmd' : 'cortes-eb', ['--help'], {
    stdio: 'ignore',
    shell: WINDOWS,
    timeout: 60_000,
  });
  return probe.error === undefined && probe.status === 0;
}

async function linkedHere() {
  const prefix = spawnSync(WINDOWS ? 'npm.cmd' : 'npm', ['prefix', '-g'], {
    encoding: 'utf8',
    shell: WINDOWS,
  });
  if (prefix.status !== 0) return false;
  const modules = WINDOWS
    ? path.join(prefix.stdout.trim(), 'node_modules', 'cortes-eb')
    : path.join(prefix.stdout.trim(), 'lib', 'node_modules', 'cortes-eb');
  try {
    return (await fs.realpath(modules)) === (await fs.realpath(ROOT));
  } catch {
    return false;
  }
}

async function ollamaExecutable() {
  if (has('ollama')) return 'ollama';
  const candidates = WINDOWS
    ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe')]
    : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function ollamaUp() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function downloadFirst(sources, folder, name) {
  let last = null;
  for (const source of sources) {
    try {
      const target = path.join(folder, name);
      await verifiedDownload(source, target);
      return target;
    } catch (error) {
      last = error;
      info(`não consegui baixar de ${new URL(source.url).host}: ${error.message}`);
    }
  }
  throw last ?? new Error('nenhuma fonte de download respondeu');
}

async function verifiedDownload(source, target) {
  const expected = await officialChecksum(source);
  const actual = await download(source.url, target);
  if (actual !== expected) {
    await fs.rm(target, { force: true });
    throw new Error(`${path.basename(source.url)} não confere com o checksum oficial`);
  }
}

async function officialChecksum(source) {
  const response = await fetch(source.sums, { redirect: 'follow' });
  if (!response.ok) throw new Error(`não consegui baixar o checksum (${response.status})`);
  const name = path.basename(new URL(source.url).pathname);
  const lines = (await response.text()).split(/\r?\n/).map((line) => line.trim().split(/\s+/));
  for (const [hash, file] of lines) {
    if (!/^[a-f0-9]{64}$/i.test(hash ?? '')) continue;
    if (file === undefined && lines.filter(([h]) => h).length === 1) return hash.toLowerCase();
    if (file?.replace(/^[*.]?\/?/, '') === name) return hash.toLowerCase();
  }
  throw new Error(`o checksum oficial de ${name} não foi publicado`);
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null)
    throw new Error(`download falhou (${response.status}) em ${new URL(url).host}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const progress = new Progress(`baixando ${path.basename(new URL(url).pathname)}`);
  const hash = createHash('sha256');
  let received = 0;
  const counted = Readable.fromWeb(response.body).on('data', (chunk) => {
    received += chunk.length;
    hash.update(chunk);
    progress.update(received, total);
  });
  await pipeline(counted, createWriteStream(target));
  progress.done();
  return hash.digest('hex');
}

async function findFile(folder, name) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found !== null) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function install(source, target) {
  await fs.copyFile(source, target);
  if (!WINDOWS) await fs.chmod(target, 0o755);
}

async function exists(file) {
  try {
    await fs.access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Progress {
  constructor(label) {
    this.label = label;
    this.last = -1;
    this.tty = process.stdout.isTTY === true;
  }

  update(done, total) {
    if (total <= 0) return;
    const percent = Math.floor((done / total) * 100);
    const stepSize = this.tty ? 1 : 10;
    if (percent - this.last < stepSize) return;
    this.last = percent;
    const text = `   ${this.label}: ${percent}% de ${(total / 1024 / 1024).toFixed(0)} MB`;
    if (this.tty) process.stdout.write(`\r${text}`);
    else console.log(text);
  }

  done() {
    if (this.tty && this.last >= 0) process.stdout.write('\n');
  }
}

function title(text) {
  console.log(`\n== ${text}`);
}

function info(text) {
  console.log(`   ${text}`);
}

function fail(message) {
  console.error(`erro: ${message}`);
  process.exit(1);
}

await main();
