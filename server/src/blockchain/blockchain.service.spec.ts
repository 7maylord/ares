import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { EscrowService } from '../submitter/escrow.service';
import { AnalysisProcessor } from '../queue/analysis.processor';
import { BountiesService } from '../bounties/bounties.service';
import { FindingsService } from '../findings/findings.service';
import { EventsService } from '../events/events.service';

const mockConfigService = {
  get: (key: string) => {
    const config: Record<string, string> = {
      POOL_ADDRESS: '0xpool',
      MANTLE_SEPOLIA_RPC_URL: 'https://rpc.sepolia.mantle.xyz',
    };
    return config[key];
  },
};

const FUTURE_DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 86400);

describe('BlockchainService', () => {
  let service: BlockchainService;
  let analysisProcessor: jest.Mocked<AnalysisProcessor>;
  let escrowService: jest.Mocked<EscrowService>;
  let bountiesService: jest.Mocked<BountiesService>;
  let findingsService: jest.Mocked<FindingsService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: EscrowService,
          useValue: {
            verifyFinding: jest.fn().mockResolvedValue('0xtxhash'),
            rejectFinding: jest.fn().mockResolvedValue('0xtxhash'),
          },
        },
        {
          provide: AnalysisProcessor,
          useValue: { run: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: BountiesService,
          useValue: {
            create: jest.fn().mockResolvedValue({ bountyId: 1 }),
            updateByBountyId: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FindingsService,
          useValue: {
            findByBountyId: jest.fn().mockResolvedValue({ id: 10, bountyId: 1 }),
            updateById: jest.fn().mockResolvedValue(undefined),
            updateByBountyId: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EventsService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    analysisProcessor = module.get(AnalysisProcessor);
    escrowService = module.get(EscrowService);
    bountiesService = module.get(BountiesService);
    findingsService = module.get(FindingsService);
    eventsService = module.get(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── handleBountyCreated ───────────────────────────────────────────────────

  describe('handleBountyCreated', () => {
    const baseArgs = {
      bountyId: BigInt(42),
      creator: '0xcreator',
      targetContract: '0xtarget',
      rewardAmount: BigInt('2000000000000000000'), // 2 ETH
      severityThreshold: 2, // High
      deadline: FUTURE_DEADLINE,
    };

    it('persists the bounty with formatted ETH and mapped severity', async () => {
      await (service as any).handleBountyCreated(baseArgs, '0xdeadbeef');

      expect(bountiesService.create).toHaveBeenCalledWith(expect.objectContaining({
        bountyId: 42,
        targetContract: '0xtarget',
        creator: '0xcreator',
        rewardAmount: '2',
        severityThreshold: 'High',
        status: 'PENDING',
        active: true,
      }));
    });

    it('maps all four severity enum values correctly', async () => {
      const severityMap: [number, string][] = [[0, 'Low'], [1, 'Medium'], [2, 'High'], [3, 'Critical']];
      for (const [num, label] of severityMap) {
        jest.clearAllMocks();
        await (service as any).handleBountyCreated({ ...baseArgs, severityThreshold: num });
        expect(bountiesService.create).toHaveBeenCalledWith(
          expect.objectContaining({ severityThreshold: label }),
        );
      }
    });

    it('logs a BountyCreated event with the txHash', async () => {
      await (service as any).handleBountyCreated(baseArgs, '0xdeadbeef');
      expect(eventsService.log).toHaveBeenCalledWith(
        'BountyCreated',
        expect.stringContaining('42'),
        '0xdeadbeef',
      );
    });

    it('fires analysis fire-and-forget with correct job params', async () => {
      await (service as any).handleBountyCreated(baseArgs);
      await Promise.resolve();
      expect(analysisProcessor.run).toHaveBeenCalledWith({
        bountyId: 42,
        targetContract: '0xtarget',
        poolAddress: '0xpool',
      });
    });

    it('does not throw if analysis processor rejects', async () => {
      analysisProcessor.run.mockRejectedValue(new Error('analysis failed'));
      await expect(
        (service as any).handleBountyCreated(baseArgs),
      ).resolves.not.toThrow();
    });
  });

  // ── handleFindingSubmitted ────────────────────────────────────────────────

  describe('handleFindingSubmitted', () => {
    const baseArgs = { findingId: BigInt(7), bountyId: BigInt(1), agent: '0xagent', severity: 2 };

    it('updates the existing finding record with on-chain IDs and txHash', async () => {
      await (service as any).handleFindingSubmitted(baseArgs, '0xfindtx');
      expect(findingsService.updateById).toHaveBeenCalledWith(10, expect.objectContaining({
        findingId: 7,
        agent: '0xagent',
        severity: 'High',
        txHash: '0xfindtx',
      }));
    });

    it('skips updateById when no existing finding record exists', async () => {
      findingsService.findByBountyId.mockResolvedValue(null);
      await (service as any).handleFindingSubmitted(baseArgs);
      expect(findingsService.updateById).not.toHaveBeenCalled();
    });

    it('calls escrowService.verifyFinding with the on-chain findingId', async () => {
      await (service as any).handleFindingSubmitted(baseArgs);
      expect(escrowService.verifyFinding).toHaveBeenCalledWith(7);
    });

    it('does not throw when escrowService.verifyFinding rejects', async () => {
      escrowService.verifyFinding.mockRejectedValue(new Error('revert'));
      await expect(
        (service as any).handleFindingSubmitted(baseArgs),
      ).resolves.not.toThrow();
    });
  });

  // ── handleFindingVerified ─────────────────────────────────────────────────

  describe('handleFindingVerified', () => {
    const baseArgs = { findingId: BigInt(7), bountyId: BigInt(1), agent: '0xagent' };

    it('marks the finding Verified and bounty VERIFIED', async () => {
      await (service as any).handleFindingVerified(baseArgs, '0xverifytx');
      expect(findingsService.updateByBountyId).toHaveBeenCalledWith(1, { status: 'Verified', payoutTxHash: '0xverifytx' });
      expect(bountiesService.updateByBountyId).toHaveBeenCalledWith(1, { status: 'VERIFIED' });
    });

    it('logs a VerificationPassed event', async () => {
      await (service as any).handleFindingVerified(baseArgs, '0xverifytx');
      expect(eventsService.log).toHaveBeenCalledWith(
        'VerificationPassed',
        expect.stringContaining('7'),
        '0xverifytx',
      );
    });
  });

  // ── handleFindingRejected ─────────────────────────────────────────────────

  describe('handleFindingRejected', () => {
    const baseArgs = { findingId: BigInt(9), bountyId: BigInt(2), agent: '0xagent' };

    it('marks the finding Rejected', async () => {
      await (service as any).handleFindingRejected(baseArgs, '0xrejecttx');
      expect(findingsService.updateByBountyId).toHaveBeenCalledWith(2, { status: 'Rejected' });
    });

    it('logs a VerificationFailed event', async () => {
      await (service as any).handleFindingRejected(baseArgs, '0xrejecttx');
      expect(eventsService.log).toHaveBeenCalledWith(
        'VerificationFailed',
        expect.stringContaining('9'),
        '0xrejecttx',
      );
    });

    it('does not update bounty status on rejection', async () => {
      await (service as any).handleFindingRejected(baseArgs);
      expect(bountiesService.updateByBountyId).not.toHaveBeenCalled();
    });
  });
});
