import { Injectable, Logger } from '@nestjs/common';
import { toHex } from 'viem';
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

  /**
   * Status to record when no vulnerabilities were returned. Only a clean scan of
   * VERIFIED source earns SECURE. A null result (analyzer error) or a
   * decompiled/bytecode-only scan can't clear a contract — that's INCONCLUSIVE,
   * never a false "secure".
   */
  private cleanResultStatus(result: { source_type?: string } | null | undefined): 'SECURE' | 'INCONCLUSIVE' {
    return result?.source_type === 'verified_source' ? 'SECURE' : 'INCONCLUSIVE';
  }

  async runProject(bountyId: number, targetContracts: string[], poolAddress: string): Promise<void> {
    const primaryContract = targetContracts[0];
    this.logger.log(`Processing project analysis for bounty ${bountyId} → [${targetContracts.join(', ')}]`);

    await this.bountiesService.updateByBountyId(bountyId, { status: 'ANALYZING' });
    await this.eventsService.log(
      'AnalysisStarted',
      `Ares Agent started project analysis for Bounty #${bountyId} (${targetContracts.length} contracts)`,
    );

    const fetchedAll = await Promise.all(
      targetContracts.map((addr) => this.contractFetcherService.fetchContract(addr).then((f) => ({ addr, ...f }))),
    );

    const contracts = fetchedAll.map((f) => ({
      address: f.addr,
      sourceCode: f.sourceCode,
      bytecode: f.bytecode,
      rawSources: f.rawSources,
    }));

    const result = await this.analyzerService.analyzeProject(contracts);
    const scannedAt = new Date();

    if (result && result.vulnerabilities_found > 0) {
      this.logger.log(`${result.vulnerabilities_found} vulnerability(s) found for project bounty ${bountyId}`);

      await this.bountiesService.updateByBountyId(bountyId, {
        status: 'VULNERABLE',
        vulnerabilitiesFound: result.vulnerabilities_found,
        scannedAt,
      });

      const severityRank: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Informational: 0 };
      const sorted = [...result.details].sort(
        (a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0),
      );

      const savedFindings = await Promise.all(
        sorted.map((v) =>
          this.findingsService.create({
            bountyId,
            targetContract: primaryContract,
            title: v.title || 'Vulnerability Found',
            severity: v.severity || 'Medium',
            category: v.category || 'Static Analysis',
            description: v.description || '',
            pocSketch: v.poc_sketch || '',
            remediation: v.remediation || '',
            status: 'Pending',
          }),
        ),
      );

      await this.eventsService.log(
        'FindingSubmitted',
        `Ares Agent found ${result.vulnerabilities_found} vulnerability(s) in Bounty #${bountyId} — submitting on-chain`,
      );

      const topFinding = sorted[0];
      const pocData = toHex(topFinding?.poc_sketch || '');
      const txHash = await this.submitterService.submitFinding(
        poolAddress,
        bountyId,
        pocData,
        topFinding?.description || 'Vulnerability detected',
        topFinding?.severity || 'High',
      );

      await Promise.all(savedFindings.map((f) => this.findingsService.updateById(f.id, { txHash })));
      await this.bountiesService.updateByBountyId(bountyId, { status: 'SUBMITTED' });
    } else {
      const status = this.cleanResultStatus(result);
      await this.bountiesService.updateByBountyId(bountyId, { status, vulnerabilitiesFound: 0, scannedAt });
      await this.eventsService.log(
        'AnalysisStarted',
        status === 'SECURE'
          ? `Ares Agent found no vulnerabilities in Bounty #${bountyId} — project appears secure`
          : `Ares Agent could not conclusively audit Bounty #${bountyId} — source unverified or decompilation inconclusive`,
      );
    }
  }

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
      this.logger.warn(`No code found for ${targetContract} — cannot audit`);
      await this.bountiesService.updateByBountyId(bountyId, { status: 'INCONCLUSIVE', vulnerabilitiesFound: 0, scannedAt: new Date() });
      return;
    }

    // Run analysis
    const result = await this.analyzerService.analyzeContract(
      targetContract,
      fetched.sourceCode,
      fetched.bytecode,
      fetched.rawSources,
    );

    const scannedAt = new Date();

    if (result && result.vulnerabilities_found > 0) {
      this.logger.log(`${result.vulnerabilities_found} vulnerability(s) found for bounty ${bountyId}`);

      await this.bountiesService.updateByBountyId(bountyId, {
        status: 'VULNERABLE',
        vulnerabilitiesFound: result.vulnerabilities_found,
        scannedAt,
      });

      // Persist every finding to the DB
      const severityRank: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Informational: 0 };
      const sorted = [...result.details].sort(
        (a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0),
      );

      const savedFindings = await Promise.all(
        sorted.map((v) =>
          this.findingsService.create({
            bountyId,
            targetContract,
            title: v.title || 'Vulnerability Found',
            severity: v.severity || 'Medium',
            category: v.category || 'Static Analysis',
            description: v.description || '',
            pocSketch: v.poc_sketch || '',
            remediation: v.remediation || '',
            status: 'Pending',
          }),
        ),
      );

      await this.eventsService.log(
        'FindingSubmitted',
        `Ares Agent found ${result.vulnerabilities_found} vulnerability(s) in Bounty #${bountyId} — submitting on-chain`,
      );

      // Submit only the highest-severity finding on-chain
      const topFinding = sorted[0];
      const pocData = toHex(topFinding?.poc_sketch || '');
      const txHash = await this.submitterService.submitFinding(
        poolAddress,
        bountyId,
        pocData,
        topFinding?.description || 'Vulnerability detected',
        topFinding?.severity || 'High',
      );

      // Attach the submission tx to all findings for this bounty
      await Promise.all(savedFindings.map((f) => this.findingsService.updateById(f.id, { txHash })));
      await this.bountiesService.updateByBountyId(bountyId, { status: 'SUBMITTED' });

    } else {
      const status = this.cleanResultStatus(result);
      this.logger.log(`No vulnerabilities returned for bounty ${bountyId} → ${status}`);

      await this.bountiesService.updateByBountyId(bountyId, {
        status,
        vulnerabilitiesFound: 0,
        scannedAt,
      });

      await this.eventsService.log(
        'AnalysisStarted',
        status === 'SECURE'
          ? `Ares Agent found no vulnerabilities in Bounty #${bountyId} — contract appears secure`
          : `Ares Agent could not conclusively audit Bounty #${bountyId} — source unverified or decompilation inconclusive`,
      );
    }
  }
}
