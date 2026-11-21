export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchWithDeadline(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    if (deadline.aborted)
      throw new ApiError('O servidor demorou para responder. Tente novamente.', 408);
    throw new ApiError(
      'Não consegui conectar ao servidor do painel. Confira se ele está rodando.',
      0,
    );
  }
}
