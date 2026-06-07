// AnalysisJob is the shared type used by AnalysisProcessor and BlockchainService.
// QueueService is commented out — it requires Redis + BullMQ (see queue.module.ts).

export interface AnalysisJob {
  bountyId: number;
  targetContract: string;
  poolAddress: string;
}

/*
 * ── FUTURE: QueueService (requires Redis + BullMQ) ──────────────────────────
 * Provides durable, retryable job enqueueing. Re-enable alongside QueueModule
 * and the @Processor version of AnalysisProcessor when moving to mainnet.
 *
 * import { Injectable, Logger } from '@nestjs/common';
 * import { InjectQueue } from '@nestjs/bullmq';
 * import { Queue } from 'bullmq';
 * import { ANALYSIS_QUEUE } from './queue.module';
 *
 * @Injectable()
 * export class QueueService {
 *   private readonly logger = new Logger(QueueService.name);
 *
 *   constructor(@InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue) {}
 *
 *   async enqueueAnalysis(job: AnalysisJob): Promise<void> {
 *     await this.analysisQueue.add('analyze', job, {
 *       attempts: 3,
 *       backoff: { type: 'exponential', delay: 5000 },
 *       removeOnComplete: true,
 *       removeOnFail: false,
 *     });
 *     this.logger.log(`Queued analysis job for bounty ${job.bountyId} → ${job.targetContract}`);
 *   }
 * }
 * ────────────────────────────────────────────────────────────────────────────
 */
