export type ChallengeStartStage =
  | 'connecting-wallet'
  | 'switching-chain'
  | 'creating-session'
  | 'awaiting-signature'
  | 'activating-session'
  | 'building-run';

export const DEFAULT_STAGE_TIMEOUT_MS = 10_000;
export const SIGN_TYPED_DATA_TIMEOUT_MS = 30_000;
export const BUILD_RUN_TIMEOUT_MS = 2_000;

export class ChallengeStartStageError extends Error {
  readonly stage: ChallengeStartStage;
  readonly kind: 'timeout' | 'failure';

  constructor(
    stage: ChallengeStartStage,
    kind: 'timeout' | 'failure',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ChallengeStartStageError';
    this.stage = stage;
    this.kind = kind;
  }
}

export interface ChallengeStartProgress {
  onStageStart?: (stage: ChallengeStartStage) => void;
}

export async function runChallengeStartStage<T>(
  stage: ChallengeStartStage,
  runner: () => Promise<T>,
  progress?: ChallengeStartProgress,
  options?: {
    timeoutMs?: number;
    timeoutMessage?: string;
    failureMessage?: string;
  },
): Promise<T> {
  progress?.onStageStart?.(stage);

  const timeoutMs = options?.timeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
  const timeoutMessage = options?.timeoutMessage ?? `${stage} 超时`;
  const failureMessage = options?.failureMessage ?? '挑战初始化失败';
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      runner(),
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new ChallengeStartStageError(stage, 'timeout', timeoutMessage),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof ChallengeStartStageError) {
      throw error;
    }

    throw new ChallengeStartStageError(
      stage,
      'failure',
      error instanceof Error ? error.message : failureMessage,
      { cause: error },
    );
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
