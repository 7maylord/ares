import { Injectable } from '@nestjs/common';

@Injectable()
export class WalletMutex {
  private queue = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    // Advance the queue regardless of fn outcome so later callers aren't blocked
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
