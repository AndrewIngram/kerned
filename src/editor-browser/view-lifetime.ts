/** Factory resources outlive resident instances, but never their mounted editor view. */
export function createViewLifetime() {
  const callbacks: (() => void)[] = [];
  let destroyed = false;

  return {
    onDestroy(this: void, callback: () => void) {
      if (destroyed) callback();
      else callbacks.push(callback);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const errors: unknown[] = [];

      for (const callback of callbacks.splice(0).toReversed()) {
        try {
          callback();
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length) throw new AggregateError(errors, 'View factory cleanup failed');
    },
  };
}
