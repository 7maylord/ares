import { Injectable, Logger } from '@nestjs/common';
import { AnalysisJob } from './queue.service';
import { ContractFetcherService } from '../blockchain/contract-fetcher.service';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { SubmitterService } from '../submitter/submitter.service';
import { BountiesService } from '../bounties/bounties.service';
import { FindingsService } from '../findings/findings.service';
import { EventsService } from '../events/events.service';

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
    private readonly bountiesService: BountiesService,
    private readonly findingsService: FindingsService,
    private readonly eventsService: EventsService,
  ) {}

  async run(job: AnalysisJob): Promise<void> {
    const { bountyId, targetContract, poolAddress } = job;
    this.logger.log(`Processing analysis for bounty ${bountyId} → ${targetContract}`);

    // Mark as analyzing
    await this.bountiesService.updateByBountyId(bountyId, { status: 'ANALYZING' });
    await this.eventsService.log(
      'AnalysisStarted',
      `Ares Agent started analysis for Bounty #${bountyId} (${targetContract})`,
    );

    // Fetch contract source / bytecode
    const fetched = await this.contractFetcherService.fetchContract(targetContract);
    if (!fetched.sourceCode && !fetched.bytecode) {
      this.logger.warn(`No code found for ${targetContract} — skipping`);
      await this.bountiesService.updateByBountyId(bountyId, { status: 'SECURE', vulnerabilitiesFound: 0, scannedAt: new Date() });
      return;
    }

    // Run analysis
    const result = await this.analyzerService.analyzeContract(
      targetContract,
      fetched.sourceCode,
      fetched.bytecode,
    );

    const scannedAt = new Date();

    if (result && result.vulnerabilities_found > 0) {
      this.logger.log(`${result.vulnerabilities_found} vulnerability(s) found for bounty ${bountyId}`);

      await this.bountiesService.updateByBountyId(bountyId, {
        status: 'VULNERABLE',
        vulnerabilitiesFound: result.vulnerabilities_found,
        scannedAt,
      });

      const topFinding = result.details[0];

      // Persist the finding before submitting on-chain
      const finding = await this.findingsService.create({
        bountyId,
        targetContract,
        title: topFinding?.title || 'Vulnerability Found',
        severity: topFinding?.severity || 'Medium',
        category: topFinding?.category || 'Static Analysis',
        description: topFinding?.description || '',
        pocSketch: topFinding?.poc_sketch || '0x',
        remediation: topFinding?.remediation || '',
        status: 'Pending',
      });

      await this.eventsService.log(
        'FindingSubmitted',
        `Ares Agent found ${result.vulnerabilities_found} vulnerability(s) in Bounty #${bountyId} — submitting on-chain`,
      );

      // Submit on-chain
      const txHash = await this.submitterService.submitFinding(
        poolAddress,
        bountyId,
        topFinding?.poc_sketch || '0x',
        topFinding?.description || 'Vulnerability detected',
      );

      // Update finding record with txHash
      await this.findingsService.updateById(finding.id, { txHash });
      await this.bountiesService.updateByBountyId(bountyId, { status: 'SUBMITTED' });

    } else {
      this.logger.log(`No vulnerabilities found for bounty ${bountyId}`);

      await this.bountiesService.updateByBountyId(bountyId, {
        status: 'SECURE',
        vulnerabilitiesFound: 0,
        scannedAt,
      });

      await this.eventsService.log(
        'AnalysisStarted',
        `Ares Agent found no vulnerabilities in Bounty #${bountyId} — contract appears secure`,
      );
    }
  }
}
