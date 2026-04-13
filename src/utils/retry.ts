const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

class TimeoutError extends Error {
  public constructor(label: string, timeoutMs: number) {
    super(`Operation timed out: ${label} after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

interface RetryOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  label: string;
  timeoutMs: number;
}

const getErrorStatus = (error: unknown): number | undefined => {
  const maybeError = error as { status?: number };
  return typeof maybeError?.status === "number" ? maybeError.status : undefined;
};

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof TimeoutError) {
    return true;
  }

  const status = getErrorStatus(error);
  if (status === 429) {
    return true;
  }

  return typeof status === "number" && status >= 500;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const withRetry = async <T>(
  action: () => Promise<T>,
  options: RetryOptions
): Promise<T> => {
  let currentBackoffMs = options.initialBackoffMs;
  let attempt = 1;

  while (attempt <= options.maxAttempts) {
    try {
      return await withTimeout(action(), options.timeoutMs, options.label);
    } catch (error) {
      const status = getErrorStatus(error);
      const retryable = isRetryableError(error);

      if (!retryable || attempt >= options.maxAttempts) {
        throw error;
      }

      console.warn(
        `[retry] label=${options.label} attempt=${attempt} status=${status ?? "n/a"} sleepingMs=${currentBackoffMs}`
      );
      await sleep(currentBackoffMs);
      currentBackoffMs *= 2;
      attempt += 1;
    }
  }

  throw new Error(`Retry failed unexpectedly for ${options.label}`);
};

