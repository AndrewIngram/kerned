/** Session factories register cleanup as resources are acquired, including before setup can fail. */
export function createExtensionLifetime() {
  const callbacks: (() => void)[] = [];
  let disposed = false;

  return {
    onDestroy(this: void, cleanup: () => void) {
      if (disposed) cleanup();
      else callbacks.push(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];

      for (const cleanup of callbacks.splice(0).toReversed()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length) throw new AggregateError(errors, 'Extension cleanup failed');
    },
  };
}
