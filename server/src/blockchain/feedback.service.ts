import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createPublicClient, http } from 'viem';
import { mantleTestnet } from 'viem/chains';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FeedbackService implements OnModuleInit {
  private readonly logger = new Logger(FeedbackService.name);
  private client: ReturnType<typeof createPublicClient>;
  private escrowAbi: any;
  private readonly ESCROW_ADDRESS: string;
  private readonly analyzerUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    const escrowAddress = this.configService.get<string>('ESCROW_ADDRESS');
    if (!escrowAddress) {
      throw new Error('ESCROW_ADDRESS environment variable is not defined');
    }
    this.ESCROW_ADDRESS = escrowAddress;

    const analyzerUrl = this.configService.get<string>('ANALYZER_SERVICE_URL');
    if (!analyzerUrl) {
      throw new Error('ANALYZER_SERVICE_URL environment variable is not defined');
    }
    this.analyzerUrl = analyzerUrl;

    this.client = createPublicClient({
      chain: mantleTestnet,
      transport: http(),
    });

    const abiPath = path.join(__dirname, '..', 'abi', 'BountyEscrow.abi.json');
    if (fs.existsSync(abiPath)) {
      this.escrowAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }
  }

  onModuleInit() {
    if (!this.escrowAbi) {
      this.logger.warn('BountyEscrow ABI not found, skipping feedback listener setup');
      return;
    }

    this.logger.log('Starting on-chain feedback listeners (FindingVerified / FindingRejected)...');

    this.client.watchContractEvent({
      address: this.ESCROW_ADDRESS as `0x${string}`,
      abi: this.escrowAbi,
      eventName: 'FindingVerified',
      onLogs: (logs) => {
        for (const log of logs) {
          const anyLog = log as any;
          this.handleFindingVerified(anyLog.args).catch((err) =>
            this.logger.error('handleFindingVerified error', err),
          );
        }
      },
    });

    this.client.watchContractEvent({
      address: this.ESCROW_ADDRESS as `0x${string}`,
      abi: this.escrowAbi,
      eventName: 'FindingRejected',
      onLogs: (logs) => {
        for (const log of logs) {
          const anyLog = log as any;
          this.handleFindingRejected(anyLog.args).catch((err) =>
            this.logger.error('handleFindingRejected error', err),
          );
        }
      },
    });
  }

  private async handleFindingVerified(args: {
    findingId: bigint;
    bountyId: bigint;
    agent: string;
  }) {
    this.logger.log(
      `FindingVerified: ID ${args.findingId}, bounty ${args.bountyId}, agent ${args.agent}`,
    );
    await this.sendFeedback(Number(args.findingId), true);
  }

  private async handleFindingRejected(args: {
    findingId: bigint;
    bountyId: bigint;
  }) {
    this.logger.log(`FindingRejected: ID ${args.findingId}, bounty ${args.bountyId}`);
    await this.sendFeedback(Number(args.findingId), false);
  }

  private async sendFeedback(findingId: number, verified: boolean): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(`${this.analyzerUrl}/feedback`, {
          finding_id: findingId,
          verified,
        }),
      );
      this.logger.log(
        `Feedback sent to analyzer for finding ${findingId}: ${verified ? 'true positive' : 'false positive'}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send feedback for finding ${findingId}`, error);
    }
  }
}
