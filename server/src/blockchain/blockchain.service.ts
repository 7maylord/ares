import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, formatEther } from 'viem';
import { mantleSepoliaTestnet } from 'viem/chains';
import { EscrowService } from '../submitter/escrow.service';
import { AnalysisProcessor } from '../queue/analysis.processor';
import { BountiesService } from '../bounties/bounties.service';
import { FindingsService } from '../findings/findings.service';
import { EventsService } from '../events/events.service';
import * as fs from 'fs';
import * as path from 'path';

const SEVERITY_LABELS = ['Low', 'Medium', 'High', 'Critical'];

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private client: ReturnType<typeof createPublicClient>;
  private poolAbi: any;
  private readonly POOL_ADDRESS: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly escrowService: EscrowService,
    private readonly analysisProcessor: AnalysisProcessor,
    private readonly bountiesService: BountiesService,
    private readonly findingsService: FindingsService,
    private readonly eventsService: EventsService,
  ) {
    const poolAddress = this.configService.get<string>('POOL_ADDRESS');
    if (!poolAddress) throw new Error('POOL_ADDRESS environment variable is not defined');
    this.POOL_ADDRESS = poolAddress;

    this.client = createPublicClient({
      chain: mantleSepoliaTestnet,
      transport: http(),
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
          const l = log as any;
          this.handleBountyCreated(l.args, l.transactionHash).catch(err =>
            this.logger.error('handleBountyCreated failed', err)
          );
        }
      },
    });

    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'FindingSubmitted',
      onLogs: (logs) => {
        for (const log of logs) {
          const l = log as any;
          this.handleFindingSubmitted(l.args, l.transactionHash).catch(err =>
            this.logger.error('handleFindingSubmitted failed', err)
          );
        }
      },
    });

    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'FindingVerified',
      onLogs: (logs) => {
        for (const log of logs) {
          const l = log as any;
          this.handleFindingVerified(l.args, l.transactionHash).catch(err =>
            this.logger.error('handleFindingVerified failed', err)
          );
        }
      },
    });

    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'FindingRejected',
      onLogs: (logs) => {
        for (const log of logs) {
          const l = log as any;
          this.handleFindingRejected(l.args, l.transactionHash).catch(err =>
            this.logger.error('handleFindingRejected failed', err)
          );
        }
      },
    });
  }

  private async handleBountyCreated(
    args: { bountyId: bigint; creator: string; targetContract: string; rewardAmount: bigint; severityThreshold: number; deadline: bigint },
    txHash?: string,
  ) {
    const bountyId = Number(args.bountyId);
    const rewardEth = formatEther(args.rewardAmount);
    const severity = SEVERITY_LABELS[Number(args.severityThreshold)] ?? 'Medium';
    const deadline = new Date(Number(args.deadline) * 1000).toISOString().split('T')[0];

    this.logger.log(`BountyCreated #${bountyId} → ${args.targetContract} (${rewardEth} ETH)`);

    await this.bountiesService.create({
      bountyId,
      targetContract: args.targetContract,
      creator: args.creator,
      rewardAmount: rewardEth,
      severityThreshold: severity,
      deadline,
      active: true,
      status: 'PENDING',
    });

    await this.eventsService.log(
      'BountyCreated',
      `Bounty #${bountyId} created for ${args.targetContract} with ${rewardEth} ETH reward`,
      txHash,
    );

    // Fire-and-forget analysis
    this.analysisProcessor.run({
      bountyId,
      targetContract: args.targetContract,
      poolAddress: this.POOL_ADDRESS,
    }).catch(err => this.logger.error(`Analysis failed for bounty ${bountyId}`, err));
  }

  private async handleFindingSubmitted(
    args: { findingId: bigint; bountyId: bigint; agent: string; severity: number },
    txHash?: string,
  ) {
    const findingId = Number(args.findingId);
    const bountyId = Number(args.bountyId);
    const severity = SEVERITY_LABELS[Number(args.severity)] ?? 'Medium';

    this.logger.log(`FindingSubmitted #${findingId} for bounty #${bountyId} by ${args.agent}`);

    // Update the finding record (created by AnalysisProcessor) with on-chain IDs
    const existing = await this.findingsService.findByBountyId(bountyId);
    if (existing) {
      await this.findingsService.updateById(existing.id, {
        findingId,
        agent: args.agent,
        severity,
        txHash,
        status: 'Pending',
      });
    }

    await this.eventsService.log(
      'FindingSubmitted',
      `Finding #${findingId} submitted for Bounty #${bountyId} by ${args.agent} (${severity})`,
      txHash,
    );

    // Auto-verify as the MVP oracle
    try {
      const verifyHash = await this.escrowService.verifyFinding(findingId);
      this.logger.log(`Finding #${findingId} auto-verified in tx: ${verifyHash}`);
    } catch (error) {
      this.logger.error(`Failed to auto-verify finding #${findingId}`, error);
    }
  }

  private async handleFindingVerified(
    args: { findingId: bigint; bountyId: bigint; agent: string },
    txHash?: string,
  ) {
    const findingId = Number(args.findingId);
    const bountyId = Number(args.bountyId);

    this.logger.log(`FindingVerified #${findingId} for bounty #${bountyId}`);

    await this.findingsService.updateByBountyId(bountyId, { status: 'Verified' });
    await this.bountiesService.updateByBountyId(bountyId, { status: 'VERIFIED' });

    await this.eventsService.log(
      'VerificationPassed',
      `Finding #${findingId} verified — payout triggered for Bounty #${bountyId}`,
      txHash,
    );
  }

  private async handleFindingRejected(
    args: { findingId: bigint; bountyId: bigint; agent: string },
    txHash?: string,
  ) {
    const findingId = Number(args.findingId);
    const bountyId = Number(args.bountyId);

    this.logger.log(`FindingRejected #${findingId} for bounty #${bountyId}`);

    await this.findingsService.updateByBountyId(bountyId, { status: 'Rejected' });

    await this.eventsService.log(
      'VerificationFailed',
      `Finding #${findingId} rejected for Bounty #${bountyId}`,
      txHash,
    );
  }
}
