import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { mantleTestnet } from 'viem/chains';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { SubmitterService } from '../submitter/submitter.service';
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
    private readonly submitterService: SubmitterService
  ) {
    this.POOL_ADDRESS = this.configService.get<string>('POOL_ADDRESS') || '0x0000000000000000000000000000000000000000';

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

    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'BountyCreated',
      onLogs: (logs) => {
        for (const log of logs) {
          this.handleBountyCreated(log.args as any);
        }
      }
    });
  }

  private async handleBountyCreated(args: { bountyId: bigint, targetContract: string }) {
    this.logger.log(`New bounty detected! ID: ${args.bountyId}, Target: ${args.targetContract}`);
    
    // 1. Send to Analyzer
    const result = await this.analyzerService.analyzeContract(args.targetContract);
    
    // 2. If vulnerable, submit finding
    if (result && result.vulnerabilities_found > 0) {
      this.logger.log('Vulnerabilities found, submitting on-chain...');
      await this.submitterService.submitFinding(
        this.POOL_ADDRESS,
        Number(args.bountyId),
        '0xdeadbeef', // Mock PoC for now
        result.details[0] || 'Vulnerability detected'
      );
    }
  }
}
