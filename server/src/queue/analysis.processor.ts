import { Injectable, Logger } from '@nestjs/common';
import { AnalysisJob } from './queue.service';
import { ContractFetcherService } from '../blockchain/contract-fetcher.service';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { SubmitterService } from '../submitter/submitter.service';

/*
 * ── FUTURE: BullMQ processor (requires Redis + QueueModule) ─────────────────
 * When Redis is available, replace this plain service with the decorated
 * processor below. Jobs will then be picked up from the Redis queue with
 * automatic retries and crash recovery.
 *
 * import { Processor, WorkerHost } from '@nestjs/bullmq';
 * import { Job } from 'bullmq';
 * import { ANALYSIS_QUEUE } from './queue.module';
 *
 * @Processor(ANALYSIS_QUEUE)
 * export class AnalysisProcessor extends WorkerHost {
 *   async process(job: Job<AnalysisJob>): Promise<void> {
 *     return this.run(job.data);
 *   }
 * }
 * ────────────────────────────────────────────────────────────────────────────
 */

@Injectable()
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly contractFetcherService: ContractFetcherService,
    private readonly analyzerService: AnalyzerService,
    private readonly submitterService: SubmitterService,
  ) {}

  async run(job: AnalysisJob): Promise<void> {
    const { bountyId, targetContract, poolAddress } = job;
    this.logger.log(`Processing analysis for bounty ${bountyId} → ${targetContract}`);

    const fetched = await this.contractFetcherService.fetchContract(targetContract);
    if (!fetched.sourceCode && !fetched.bytecode) {
      this.logger.warn(`No code found for ${targetContract} — skipping`);
      return;
    }
    this.logger.log(
      `${targetContract} — verified: ${fetched.isVerified}, ` +
      `source: ${fetched.sourceCode ? 'yes' : 'no'}, bytecode: ${fetched.bytecode ? 'yes' : 'no'}`
    );

    const result = await this.analyzerService.analyzeContract(
      targetContract,
      fetched.sourceCode,
      fetched.bytecode,
    );

    if (result && result.vulnerabilities_found > 0) {
      this.logger.log(`${result.vulnerabilities_found} vulnerability(s) found — submitting on-chain`);
      const topFinding = result.details[0];
      await this.submitterService.submitFinding(
        poolAddress,
        bountyId,
        topFinding?.poc_sketch || '0x',
        topFinding?.description || 'Vulnerability detected',
      );
    } else {
      this.logger.log(`No vulnerabilities found for bounty ${bountyId}`);
    }
  }
}
