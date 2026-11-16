import { Injectable } from '@nestjs/common';

@Injectable()
export class Output {
  json(data: unknown): void {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  }

  line(text: string): void {
    process.stdout.write(`${text}\n`);
  }

  info(text: string): void {
    process.stderr.write(`${text}\n`);
  }
}
