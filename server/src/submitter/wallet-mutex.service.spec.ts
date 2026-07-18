import { WalletMutex } from './wallet-mutex.service';

describe('WalletMutex', () => {
  let mutex: WalletMutex;

  beforeEach(() => {
    mutex = new WalletMutex();
  });

  it('serializes concurrent calls — no overlap', async () => {
    const order: string[] = [];

    const task = (id: string, delay: number) =>
      mutex.run(async () => {
        order.push(`start:${id}`);
        await new Promise((r) => setTimeout(r, delay));
        order.push(`end:${id}`);
      });

    // Fire all three at once
    await Promise.all([task('A', 20), task('B', 10), task('C', 5)]);

    // Each must fully complete before the next starts
    expect(order).toEqual(['start:A', 'end:A', 'start:B', 'end:B', 'start:C', 'end:C']);
  });

  it('a failing call does not block subsequent calls', async () => {
    const results: string[] = [];

    await Promise.allSettled([
      mutex.run(async () => { throw new Error('boom'); }),
      mutex.run(async () => { results.push('ran'); }),
    ]);

    expect(results).toEqual(['ran']);
  });
});
