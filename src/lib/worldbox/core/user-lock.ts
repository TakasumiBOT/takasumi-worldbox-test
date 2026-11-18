const locks = new Map<string, Promise<void>>();

export async function withUserLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.then(() => gate);
  locks.set(key, tail);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
