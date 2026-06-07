import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { EscrowService } from '../submitter/escrow.service';
import { AnalysisProcessor } from '../queue/analysis.processor';

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
  let analysisProcessor: jest.Mocked<AnalysisProcessor>;
  let escrowService: jest.Mocked<EscrowService>;

  beforeEach(async () => {
    const mockAnalysisProcessor = { run: jest.fn().mockResolvedValue(undefined) };
    const mockEscrowService = {
      verifyFinding: jest.fn().mockResolvedValue('0xtxhash'),
      rejectFinding: jest.fn().mockResolvedValue('0xtxhash'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EscrowService, useValue: mockEscrowService },
        { provide: AnalysisProcessor, useValue: mockAnalysisProcessor },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    analysisProcessor = module.get(AnalysisProcessor);
    escrowService = module.get(EscrowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleBountyCreated', () => {
    it('runs analysis fire-and-forget with bountyId, targetContract, and poolAddress', async () => {
      (service as any).handleBountyCreated({
        bountyId: BigInt(42),
        targetContract: '0xtarget',
      });

      // allow the microtask to flush
      await Promise.resolve();

      expect(analysisProcessor.run).toHaveBeenCalledWith({
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
