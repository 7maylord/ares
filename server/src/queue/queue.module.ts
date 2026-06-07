import { Module } from '@nestjs/common';

/*
 * ── FUTURE: Redis / BullMQ Queue Module ─────────────────────────────────────
 * Restore this when job durability and retries matter (mainnet, real bounties).
 * A crashed server will lose in-flight analysis jobs without a persistent queue.
 *
 * Prerequisites:
 *   1. Add Redis: docker-compose service or Render Redis addon
 *   2. Set REDIS_HOST and REDIS_PORT env vars
 *   3. pnpm add @nestjs/bullmq bullmq   (already in package.json)
 *   4. Import QueueModule in BlockchainModule, add QueueService to providers
 *   5. Re-enable the BullMQ processor in analysis.processor.ts
 *
 * import { BullModule } from '@nestjs/bullmq';
 * import { ConfigModule, ConfigService } from '@nestjs/config';
 *
 * export const ANALYSIS_QUEUE = 'analysis';
 *
 * @Module({
 *   imports: [
 *     BullModule.forRootAsync({
 *       imports: [ConfigModule],
 *       inject: [ConfigService],
 *       useFactory: (configService: ConfigService) => ({
 *         connection: {
 *           host: configService.get<string>('REDIS_HOST') || 'localhost',
 *           port: configService.get<number>('REDIS_PORT') || 6379,
 *         },
 *       }),
 *     }),
 *     BullModule.registerQueue({ name: ANALYSIS_QUEUE }),
 *   ],
 *   exports: [BullModule],
 * })
 * export class QueueModule {}
 * ────────────────────────────────────────────────────────────────────────────
 */

export const ANALYSIS_QUEUE = 'analysis';

@Module({})
export class QueueModule {}
