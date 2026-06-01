import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { mantleTestnet } from 'viem/chains';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { SubmitterService } from '../submitter/submitter.service';
import { EscrowService } from '../submitter/escrow.service';
import { ContractFetcherService } from './contract-fetcher.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private client: ReturnType<typeof createPublicClient>;
  private poolAbi: any;
  private readonly POOL_ADDRESS: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly analyzerService: AnalyzerService,
    private readonly submitterService: SubmitterService,
    private readonly escrowService: EscrowService,
    private readonly contractFetcherService: ContractFetcherService,
  ) {
    const poolAddress = this.configService.get<string>('POOL_ADDRESS');
    if (!poolAddress) {
      throw new Error('POOL_ADDRESS environment variable is not defined');
    }
    this.POOL_ADDRESS = poolAddress;

    this.client = createPublicClient({
      chain: mantleTestnet,
      transport: http()
    });

    const abiPath = path.join(__dirname, '..', 'abi', 'BountyPool.abi.json');
    if (fs.existsSync(abiPath)) {
      this.poolAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }
  }

  onModuleInit() {
    this.logger.log('Starting blockchain event listeners...');
    if (!this.poolAbi) {
      this.logger.warn('Pool ABI not found, skipping event listener setup');
      return;
    }

    // Listen for BountyCreated events to analyze new contracts
    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'BountyCreated',
      onLogs: (logs) => {
        for (const log of logs) {
          const anyLog = log as any;
          this.handleBountyCreated(anyLog.args);
        }
      }
    });

    // Listen for FindingSubmitted events to automatically verify them (MVP Oracle)
    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'FindingSubmitted',
      onLogs: (logs) => {
        for (const log of logs) {
          const anyLog = log as any;
          this.handleFindingSubmitted(anyLog.args);
        }
      }
    });
  }

  private async handleBountyCreated(args: { bountyId: bigint, targetContract: string }) {
    this.logger.log(`New bounty detected! ID: ${args.bountyId}, Target: ${args.targetContract}`);

    // 1. Fetch contract code (verified source or raw bytecode)
    const fetched = await this.contractFetcherService.fetchContract(args.targetContract);
    if (!fetched.sourceCode && !fetched.bytecode) {
      this.logger.warn(`No code found for ${args.targetContract}, skipping analysis`);
      return;
    }
    this.logger.log(
      `Contract ${args.targetContract} — verified: ${fetched.isVerified}, ` +
      `source: ${fetched.sourceCode ? 'yes' : 'no'}, bytecode: ${fetched.bytecode ? 'yes' : 'no'}`
    );

    // 2. Send to Analyzer with real code
    const result = await this.analyzerService.analyzeContract(
      args.targetContract,
      fetched.sourceCode,
      fetched.bytecode,
    );

    // 3. If vulnerable, submit finding
    if (result && result.vulnerabilities_found > 0) {
      this.logger.log('Vulnerabilities found, submitting on-chain...');
      await this.submitterService.submitFinding(
        this.POOL_ADDRESS,
        Number(args.bountyId),
        '0xdeadbeef', // Mock PoC for now — replaced by real PoC generator later
        result.details[0] || 'Vulnerability detected'
      );
    }
  }

  private async handleFindingSubmitted(args: { findingId: bigint, bountyId: bigint, agent: string, severity: number }) {
    this.logger.log(`Finding submitted: ID ${args.findingId} for bounty ${args.bountyId} by agent ${args.agent}`);
    try {
      this.logger.log(`Automatically verifying finding ID ${args.findingId} via EscrowService...`);
      const hash = await this.escrowService.verifyFinding(Number(args.findingId));
      this.logger.log(`Finding ID ${args.findingId} verified in tx: ${hash}`);
    } catch (error) {
      this.logger.error(`Failed to automatically verify finding ID ${args.findingId}`, error);
    }
  }
}
