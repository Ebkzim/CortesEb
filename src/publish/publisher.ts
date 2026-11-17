import type { Job, Platform } from '../contracts/publish.js';

export interface PublishResult {
  url: string;
}

export interface Publisher {
  readonly platform: Platform;
  publish(job: Job): Promise<PublishResult>;
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}
