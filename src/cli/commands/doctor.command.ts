import { Command } from 'nest-commander';
import { Output } from '../../common/output.js';
import { UserConfigStore } from '../../config/user-config.js';
import { DoctorService } from '../../doctor/doctor.service.js';
import { RemotionEngine } from '../../render/remotion-engine.js';
import { Whisper } from '../../transcription/whisper.js';
import { GuardedCommand } from '../guarded-command.js';

@Command({ name: 'doctor', description: 'confere o que está instalado e configurado' })
export class DoctorCommand extends GuardedCommand {
  constructor(
    private readonly doctor: DoctorService,
    private readonly output: Output,
  ) {
    super();
  }

  protected async execute(): Promise<void> {
    this.output.json(await this.doctor.report());
  }
}

@Command({ name: 'setup', description: 'instala o whisper.cpp, o modelo e o navegador do render' })
export class SetupCommand extends GuardedCommand {
  constructor(
    private readonly doctor: DoctorService,
    private readonly config: UserConfigStore,
    private readonly whisper: Whisper,
    private readonly engine: RemotionEngine,
    private readonly output: Output,
  ) {
    super();
  }

  protected async execute(): Promise<void> {
    const config = await this.config.update({});
    if (!(await this.whisper.isReady(config.whisperModel))) {
      this.output.info(`> instalando whisper.cpp e o modelo ${config.whisperModel}`);
      await this.whisper.install(config.whisperModel);
    }
    this.output.info('> conferindo o navegador do render');
    await this.engine.ensureBrowser();
    this.output.json(await this.doctor.report());
  }
}
