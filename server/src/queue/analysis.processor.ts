import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ANALYSIS_QUEUE, } from './queue.module';
import { AnalysisJob } from './queue.service';
import { ContractFetcherService } from '../blockchain/contract-fetcher.service';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { SubmitterService } from '../submitter/submitter.service';

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly contractFetcherService: ContractFetcherService,
    private readonly analyzerService: AnalyzerService,
    private readonly submitterService: SubmitterService,
  ) {}

  @Process()
  async handle(job: Job<AnalysisJob>): Promise<void> {
    const { bountyId, targetContract, poolAddress } = job.data;
    this.logger.log(`Processing analysis job for bounty ${bountyId} → ${targetContract}`);

    // 1. Fetch real contract code (hybrid: source + bytecode)
    const fetched = await this.contractFetcherService.fetchContract(targetContract);
    if (!fetched.sourceCode && !fetched.bytecode) {
      this.logger.warn(`No code found for ${targetContract} — skipping`);
      return;
    }
    this.logger.log(
      `${targetContract} — verified: ${fetched.isVerified}, ` +
      `source: ${fetched.sourceCode ? 'yes' : 'no'}, bytecode: ${fetched.bytecode ? 'yes' : 'no'}`
    );

    // 2. Analyze
    const result = await this.analyzerService.analyzeContract(
      targetContract,
      fetched.sourceCode,
      fetched.bytecode,
    );

    // 3. Submit finding if vulnerabilities found
    if (result && result.vulnerabilities_found > 0) {
      this.logger.log(`${result.vulnerabilities_found} vulnerability(s) found — submitting on-chain`);
      const topFinding = result.details[0];
      await this.submitterService.submitFinding(
        poolAddress,
        bountyId,
        topFinding?.poc_data || '0xdeadbeef',
        topFinding?.description || 'Vulnerability detected',
      );
    } else {
      this.logger.log(`No vulnerabilities found for bounty ${bountyId}`);
    }
  }
}
