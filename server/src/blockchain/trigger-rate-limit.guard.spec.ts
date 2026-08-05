import { ExecutionContext, HttpException } from '@nestjs/common';
import { TriggerRateLimitGuard } from './trigger-rate-limit.guard';

// Subclass to control the clock so the daily-window behaviour is testable
// without waiting 24h. WHY: the whole point of the guard is enforcing a limit
// over time, and a test that can't advance time can't prove the reset works.
class TestableGuard extends TriggerRateLimitGuard {
  clock = 1_000_000;
  protected now(): number {
    return this.clock;
  }
  advance(ms: number) {
    this.clock += ms;
  }
}

function ctxFor(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

function statusOf(fn: () => void): number {
  try {
    fn();
    return 0; // did not throw
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

describe('TriggerRateLimitGuard', () => {
  let guard: TestableGuard;

  beforeEach(() => {
    guard = new TestableGuard();
  });

  it('allows exactly MAX_PER_WINDOW (2) requests from one IP', () => {
    const ctx = ctxFor('1.1.1.1');
    expect(guard.canActivate(ctx)).toBe(true); // 1st
    expect(guard.canActivate(ctx)).toBe(true); // 2nd
  });

  it('blocks the 3rd request from the same IP with HTTP 429', () => {
    const ctx = ctxFor('1.1.1.1');
    guard.canActivate(ctx);
    guard.canActivate(ctx);
    // 3rd must be rejected — this is the behaviour that protects DeepSeek spend
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
    expect(statusOf(() => guard.canActivate(ctx))).toBe(429);
  });

  it('counts each IP independently', () => {
    const a = ctxFor('1.1.1.1');
    const b = ctxFor('2.2.2.2');
    guard.canActivate(a);
    guard.canActivate(a); // A is now at its limit
    expect(statusOf(() => guard.canActivate(a))).toBe(429);
    // B is untouched and still gets its own 2
    expect(guard.canActivate(b)).toBe(true);
    expect(guard.canActivate(b)).toBe(true);
    expect(statusOf(() => guard.canActivate(b))).toBe(429);
  });

  it('resets the count once the daily window elapses', () => {
    const ctx = ctxFor('1.1.1.1');
    guard.canActivate(ctx);
    guard.canActivate(ctx);
    expect(statusOf(() => guard.canActivate(ctx))).toBe(429); // blocked within window

    guard.advance(TriggerRateLimitGuard.WINDOW_MS); // a full day passes
    expect(guard.canActivate(ctx)).toBe(true); // window reset → allowed again
    expect(guard.canActivate(ctx)).toBe(true); // and gets the full quota back
    expect(statusOf(() => guard.canActivate(ctx))).toBe(429);
  });

  it('does NOT reset one second before the window closes', () => {
    const ctx = ctxFor('1.1.1.1');
    guard.canActivate(ctx);
    guard.canActivate(ctx);
    guard.advance(TriggerRateLimitGuard.WINDOW_MS - 1000); // still inside the window
    expect(statusOf(() => guard.canActivate(ctx))).toBe(429);
  });

  it('falls back to socket address when req.ip is absent', () => {
    const req = { socket: { remoteAddress: '9.9.9.9' } } as unknown as Parameters<
      TriggerRateLimitGuard['getClientIp']
    >[0];
    expect(guard.getClientIp(req)).toBe('9.9.9.9');
  });
});
