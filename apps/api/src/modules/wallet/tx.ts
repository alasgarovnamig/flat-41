import type { Database, Tx } from '../../db/db.module';

/**
 * Runs `fn` inside the caller's transaction when one is given, otherwise opens a new one.
 * Lets money services be composed into a bigger atomic unit (e.g. booking insert + wallet debit + fulfilment).
 */
export const withTx = <T>(db: Database, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  tx ? fn(tx) : db.transaction(fn);

/** Runs post-commit side effects (notifications, events) without letting one failure break the others. */
export const runEffects = async (effects: Array<() => Promise<unknown>>, onError: (e: unknown) => void) => {
  for (const effect of effects) {
    try {
      await effect();
    } catch (e) {
      onError(e);
    }
  }
};
