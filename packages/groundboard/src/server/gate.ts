export class BusyError extends Error {
  constructor() {
    super("the server is busy laying out other boards; try again shortly");
    this.name = "BusyError";
  }
}

export type Gate = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Runs at most `concurrency` tasks at once and queues up to `queue` more; a task arriving
 * when the queue is full is rejected with `BusyError` instead of waiting.
 */
export function createGate(concurrency: number, queue: number): Gate {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      if (waiting.length >= queue) throw new BusyError();
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

export class ClientBusyError extends Error {
  constructor() {
    super("this client already has a board being laid out; wait for it to finish");
    this.name = "ClientBusyError";
  }
}

/** Allows each key at most `perKey` tasks in flight (running or queued) at once. */
export function createPerKeyLimit(perKey: number) {
  const inFlight = new Map<string, number>();
  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const count = inFlight.get(key) ?? 0;
    if (count >= perKey) throw new ClientBusyError();
    inFlight.set(key, count + 1);
    try {
      return await task();
    } finally {
      const left = (inFlight.get(key) ?? 1) - 1;
      if (left === 0) inFlight.delete(key);
      else inFlight.set(key, left);
    }
  };
}
