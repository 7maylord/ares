import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Per-IP daily rate limit for the free `/analysis/trigger` endpoints, so the
 * public manual-trigger can't be used to spam the analyzer (Slither + DeepSeek).
 *
 * ponytail: in-memory, per-instance. Counters reset on restart and aren't shared
 * across replicas — fine as an abuse brake on a single Railway instance. Move the
 * store to Redis if this ever runs multi-replica.
 *
 * Relies on Express `trust proxy` (set in main.ts) so `req.ip` is the real client
 * behind Railway's edge, not the proxy address — otherwise every caller shares one
 * bucket.
 */
@Injectable()
export class TriggerRateLimitGuard implements CanActivate {
  static readonly WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day
  static readonly MAX_PER_WINDOW = 2;

  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  /** Overridable in tests. */
  protected now(): number {
    return Date.now();
  }

  getClientIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(req);
    const now = this.now();

    let bucket = this.hits.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + TriggerRateLimitGuard.WINDOW_MS };
      this.hits.set(ip, bucket);
      this.prune(now);
    }

    if (bucket.count >= TriggerRateLimitGuard.MAX_PER_WINDOW) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit reached: ${TriggerRateLimitGuard.MAX_PER_WINDOW} analysis triggers per IP per day.`,
          retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count += 1;
    return true;
  }

  /** Drop expired buckets so the map can't grow unbounded from many IPs. */
  private prune(now: number): void {
    if (this.hits.size < 5000) return;
    for (const [ip, b] of this.hits) {
      if (now >= b.resetAt) this.hits.delete(ip);
    }
  }
}
