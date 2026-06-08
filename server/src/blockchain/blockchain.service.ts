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
  private reputationAbi: any;
  private readonly REPUTATION_ADDRESS: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly escrowService: EscrowService,
    private readonly analysisProcessor: AnalysisProcessor,
    private readonly bountiesService: BountiesService,
    private readonly findingsService: FindingsService,
    private readonly eventsService: EventsService,
  ) {
    const poolAddress = this.configService.get<string>('POOL_ADDRESS');
    if (!poolAddress)
      throw new Error('POOL_ADDRESS environment variable is not defined');
    this.POOL_ADDRESS = poolAddress;

    this.REPUTATION_ADDRESS =
      this.configService.get<string>('REPUTATION_ADDRESS') ??
      '0x2986F9236991F156aEfB94F369551a95E67F0aCc';

    this.client = createPublicClient({
      chain: mantleSepoliaTestnet,
      transport: http(),
    });

    const abiPath = path.join(__dirname, '..', 'abi', 'BountyPool.abi.json');
    if (fs.existsSync(abiPath)) {
      this.poolAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }

    const repAbiPath = path.join(
      __dirname,
      '..',
      'abi',
      'ReputationLedger.abi.json',
    );
    if (fs.existsSync(repAbiPath)) {
      this.reputationAbi = JSON.parse(fs.readFileSync(repAbiPath, 'utf8'));
    }
  }

  async onModuleInit() {
    this.logger.log('Starting blockchain event listeners...');
    if (!this.poolAbi) {
      this.logger.warn('Pool ABI not found, skipping event listener setup');
      return;
    }

    await this.checkAgentReputation();
    await this.backfillPastEvents();
    await this.backfillPendingFindings();

    this.client.watchContractEvent({
      address: this.POOL_ADDRESS as `0x${string}`,
      abi: this.poolAbi,
      eventName: 'BountyCreated',
      onLogs: (logs) => {
        for (const log of logs) {
          const l = log as any;
          this.handleBountyCreated(l.args, l.transactionHash).catch((err) =>
            this.logger.error('handleBountyCreated failed', err),
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
          this.handleFindingSubmitted(l.args, l.transactionHash).catch((err) =>
            this.logger.error('handleFindingSubmitted failed', err),
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
          this.handleFindingVerified(l.args, l.transactionHash).catch((err) =>
            this.logger.error('handleFindingVerified failed', err),
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
          this.handleFindingRejected(l.args, l.transactionHash).catch((err) =>
            this.logger.error('handleFindingRejected failed', err),
          );
        }
      },
    });
  }

  private async checkAgentReputation() {
    if (!this.reputationAbi) return;
    try {
      const pk = this.configService.get<string>('AGENT_PRIVATE_KEY');
      if (!pk) return;
      const { privateKeyToAccount } = await import('viem/accounts');
      const agentAddress = privateKeyToAccount(pk as `0x${string}`).address;

      const score = (await this.client.readContract({
        address: this.REPUTATION_ADDRESS as `0x${string}`,
        abi: this.reputationAbi,
        functionName: 'reputationScore',
        args: [agentAddress],
      })) as bigint;

      if (score === 0n) {
        this.logger.error(
          `⚠ Agent ${agentAddress} has reputation score 0 (unregistered). ` +
            `submitFinding will revert. Run: cast send ${this.REPUTATION_ADDRESS} "registerAgent(address)" ${agentAddress} --private-key <DEPLOYER_KEY> --rpc-url https://rpc.sepolia.mantle.xyz`,
        );
      } else {
        this.logger.log(`Agent ${agentAddress} reputation score: ${score}`);
      }
    } catch (err) {
      this.logger.warn('Could not check agent reputation', err);
    }
  }

  private async backfillPastEvents() {
    this.logger.log('Syncing bounties from on-chain contract state...');
    try {
      const nextId = (await this.client.readContract({
        address: this.POOL_ADDRESS as `0x${string}`,
        abi: this.poolAbi,
        functionName: 'nextBountyId',
      })) as bigint;

      this.logger.log(
        `Contract reports ${nextId} bounty(s) — checking database...`,
      );

      for (let id = 0n; id < nextId; id++) {
        const existing = await this.bountiesService.findByBountyId(Number(id));
        if (existing) continue;

        const bounty = (await this.client.readContract({
          address: this.POOL_ADDRESS as `0x${string}`,
          abi: this.poolAbi,
          functionName: 'getBounty',
          args: [id],
        })) as {
          targetContract: string;
          bountyCreator: string;
          rewardAmount: bigint;
          severityThreshold: number;
          active: boolean;
          deadline: bigint;
        };

        const rewardEth = formatEther(bounty.rewardAmount);
        const severity =
          SEVERITY_LABELS[Number(bounty.severityThreshold)] ?? 'Medium';
        const deadline = new Date(Number(bounty.deadline) * 1000)
          .toISOString()
          .split('T')[0];

        this.logger.log(
          `Importing missing bounty #${id} → ${bounty.targetContract}`,
        );
        await this.bountiesService.create({
          bountyId: Number(id),
          targetContract: bounty.targetContract,
          creator: bounty.bountyCreator,
          rewardAmount: rewardEth,
          severityThreshold: severity,
          deadline,
          active: bounty.active,
          status: 'PENDING',
        });

        this.analysisProcessor
          .run({
            bountyId: Number(id),
            targetContract: bounty.targetContract,
            poolAddress: this.POOL_ADDRESS,
          })
          .catch((err) =>
            this.logger.error(`Analysis failed for bounty ${id}`, err),
          );
      }
    } catch (err) {
      this.logger.error('Failed to sync on-chain bounties', err);
    }
  }

  private async backfillPendingFindings() {
    this.logger.log('Syncing on-chain finding statuses to database...');
    try {
      const nextId = (await this.client.readContract({
        address: this.POOL_ADDRESS as `0x${string}`,
        abi: this.poolAbi,
        functionName: 'nextFindingId',
      })) as bigint;

      for (let id = 0n; id < nextId; id++) {
        const finding = (await this.client.readContract({
          address: this.POOL_ADDRESS as `0x${string}`,
          abi: this.poolAbi,
          functionName: 'getFinding',
          args: [id],
        })) as { agent: string; bountyId: bigint; status: number; severity: number };

        const bountyId = Number(finding.bountyId);
        const findingId = Number(id);
        const dbFinding = await this.findingsService.findByBountyId(bountyId);

        // FindingStatus: 0=Pending, 1=Verified, 2=Rejected
        if (finding.status === 1) {
          // Verified on-chain but DB not updated — sync it
          this.logger.log(`Finding #${findingId} is Verified on-chain — syncing DB`);
          if (dbFinding) {
            await this.findingsService.updateById(dbFinding.id, {
              findingId,
              agent: finding.agent,
              status: 'Verified',
            });
          }
          await this.bountiesService.updateByBountyId(bountyId, { status: 'VERIFIED' });
          await this.eventsService.log(
            'VerificationPassed',
            `Finding #${findingId} verified on-chain — DB synced for Bounty #${bountyId}`,
          );
          continue;
        }

        if (finding.status === 2) {
          // Rejected on-chain but DB not updated — sync it
          this.logger.log(`Finding #${findingId} is Rejected on-chain — syncing DB`);
          if (dbFinding) {
            await this.findingsService.updateById(dbFinding.id, {
              findingId,
              agent: finding.agent,
              status: 'Rejected',
            });
          }
          continue;
        }

        // status === 0: Pending on-chain — trigger auto-verify
        this.logger.log(`Finding #${findingId} is Pending on-chain — triggering auto-verify`);
        if (dbFinding && dbFinding.findingId == null) {
          await this.findingsService.updateById(dbFinding.id, {
            findingId,
            agent: finding.agent,
          });
        }
        try {
          const verifyHash = await this.escrowService.verifyFinding(findingId);
          this.logger.log(`Finding #${findingId} auto-verified in tx: ${verifyHash}`);
        } catch (err) {
          this.logger.error(`Auto-verify failed for finding #${findingId}`, err);
        }
      }
    } catch (err) {
      this.logger.error('Failed to sync on-chain findings', err);
    }
  }

  private async handleBountyCreated(
    args: {
      bountyId: bigint;
      creator: string;
      targetContract: string;
      rewardAmount: bigint;
      severityThreshold: number;
      deadline: bigint;
    },
    txHash?: string,
  ) {
    const bountyId = Number(args.bountyId);
    const rewardEth = formatEther(args.rewardAmount);
    const severity =
      SEVERITY_LABELS[Number(args.severityThreshold)] ?? 'Medium';
    const deadline = new Date(Number(args.deadline) * 1000)
      .toISOString()
      .split('T')[0];

    this.logger.log(
      `BountyCreated #${bountyId} → ${args.targetContract} (${rewardEth} ETH)`,
    );

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
    this.analysisProcessor
      .run({
        bountyId,
        targetContract: args.targetContract,
        poolAddress: this.POOL_ADDRESS,
      })
      .catch((err) =>
        this.logger.error(`Analysis failed for bounty ${bountyId}`, err),
      );
  }

  private async handleFindingSubmitted(
    args: {
      findingId: bigint;
      bountyId: bigint;
      agent: string;
      severity: number;
    },
    txHash?: string,
  ) {
    const findingId = Number(args.findingId);
    const bountyId = Number(args.bountyId);
    const severity = SEVERITY_LABELS[Number(args.severity)] ?? 'Medium';

    this.logger.log(
      `FindingSubmitted #${findingId} for bounty #${bountyId} by ${args.agent}`,
    );

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
      this.logger.log(
        `Finding #${findingId} auto-verified in tx: ${verifyHash}`,
      );
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

    await this.findingsService.updateByBountyId(bountyId, {
      status: 'Verified',
    });
    await this.bountiesService.updateByBountyId(bountyId, {
      status: 'VERIFIED',
    });

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

    await this.findingsService.updateByBountyId(bountyId, {
      status: 'Rejected',
    });

    await this.eventsService.log(
      'VerificationFailed',
      `Finding #${findingId} rejected for Bounty #${bountyId}`,
      txHash,
    );
  }
}
