const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function createTimeoutError(timeoutMs) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function combineAbortSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (!activeSignals.length) {
    return { signal: undefined, cleanup() {} };
  }
  if (activeSignals.length === 1) {
    return { signal: activeSignals[0], cleanup() {} };
  }

  const controller = new AbortController();
  const listeners = [];

  const abortFrom = (source) => {
    if (controller.signal.aborted) return;
    const reason = source?.reason;
    if (typeof reason === "undefined") {
      controller.abort();
      return;
    }
    controller.abort(reason);
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      return { signal: controller.signal, cleanup() {} };
    }

    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }

  return {
    signal: controller.signal,
    cleanup() {
      listeners.forEach(({ signal, listener }) => {
        signal.removeEventListener("abort", listener);
      });
    },
  };
}

export function isTimeoutLikeError(error) {
  return String(error?.name ?? "").trim() === "TimeoutError"
    || /timed out/i.test(String(error?.message ?? ""));
}

export async function fetchWithTimeout(input, init = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const timeoutError = createTimeoutError(timeoutMs);
  const { signal, cleanup } = combineAbortSignals([init.signal, timeoutController.signal]);
  let timeoutId;

  try {
    const request = fetch(input, {
      ...init,
      ...(signal ? { signal } : {}),
    });
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timeoutController.abort(timeoutError);
        reject(timeoutError);
      }, timeoutMs);
    });

    return await Promise.race([request, timeout]);
  } finally {
    cleanup();
    clearTimeout(timeoutId);
  }
}

export { DEFAULT_REQUEST_TIMEOUT_MS };
