import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ANALYSIS_QUEUE } from './queue.module';

export interface AnalysisJob {
  bountyId: number;
  targetContract: string;
  poolAddress: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue(ANALYSIS_QUEUE) private readonly analysisQueue: Queue) {}

  async enqueueAnalysis(job: AnalysisJob): Promise<void> {
    await this.analysisQueue.add(job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
    this.logger.log(`Queued analysis job for bounty ${job.bountyId} → ${job.targetContract}`);
  }
}
