export type ErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_DEPENDENCY'
  | 'MISSING_FILE'
  | 'MISSING_SECRET'
  | 'NOT_CONFIGURED'
  | 'PROCESS_FAILED'
  | 'REMOTE_FAILED'
  | 'UNSAFE_PATH'
  | 'UNSAFE_URL';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
