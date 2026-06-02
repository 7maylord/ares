import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { AnalyzerService } from '../analyzer/analyzer.service';
import { SubmitterService } from '../submitter/submitter.service';
import { EscrowService } from '../submitter/escrow.service';
import { ContractFetcherService } from './contract-fetcher.service';
import { QueueService } from '../queue/queue.service';

const mockConfigService = {
  get: (key: string) => {
    const config: Record<string, string> = {
      POOL_ADDRESS: '0xpool',
      MANTLE_SEPOLIA_RPC_URL: 'https://rpc.sepolia.mantle.xyz',
    };
    return config[key];
  },
};

describe('BlockchainService', () => {
  let service: BlockchainService;
  let queueService: jest.Mocked<QueueService>;
  let escrowService: jest.Mocked<EscrowService>;

  beforeEach(async () => {
    const mockQueueService = { enqueueAnalysis: jest.fn().mockResolvedValue(undefined) };
    const mockAnalyzerService = { analyzeContract: jest.fn() };
    const mockSubmitterService = { submitFinding: jest.fn() };
    const mockEscrowService = {
      verifyFinding: jest.fn().mockResolvedValue('0xtxhash'),
      rejectFinding: jest.fn().mockResolvedValue('0xtxhash'),
    };
    const mockContractFetcherService = { fetchContract: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AnalyzerService, useValue: mockAnalyzerService },
        { provide: SubmitterService, useValue: mockSubmitterService },
        { provide: EscrowService, useValue: mockEscrowService },
        { provide: ContractFetcherService, useValue: mockContractFetcherService },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    queueService = module.get(QueueService);
    escrowService = module.get(EscrowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleBountyCreated', () => {
    it('enqueues an analysis job with bountyId, targetContract, and poolAddress', async () => {
      await (service as any).handleBountyCreated({
        bountyId: BigInt(42),
        targetContract: '0xtarget',
      });

      expect(queueService.enqueueAnalysis).toHaveBeenCalledWith({
        bountyId: 42,
        targetContract: '0xtarget',
        poolAddress: '0xpool',
      });
    });
  });

  describe('handleFindingSubmitted', () => {
    it('calls escrowService.verifyFinding with the correct findingId', async () => {
      await (service as any).handleFindingSubmitted({
        findingId: BigInt(7),
        bountyId: BigInt(1),
        agent: '0xagent',
        severity: 3,
      });

      expect(escrowService.verifyFinding).toHaveBeenCalledWith(7);
    });

    it('does not throw if escrowService.verifyFinding fails', async () => {
      escrowService.verifyFinding.mockRejectedValue(new Error('revert'));

      await expect(
        (service as any).handleFindingSubmitted({
          findingId: BigInt(99),
          bountyId: BigInt(1),
          agent: '0xagent',
          severity: 3,
        }),
      ).resolves.not.toThrow();
    });
  });
});
