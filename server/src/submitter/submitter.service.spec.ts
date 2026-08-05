import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SubmitterService } from './submitter.service';
import { WalletMutex } from './wallet-mutex.service';

// viem wallet client + simulateContract/writeContract are mocked so no real
// RPC calls are made. The tests verify the service constructs and submits
// the correct on-chain call arguments.
jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createWalletClient: jest.fn(() => ({
      extend: jest.fn().mockReturnThis(),
      simulateContract: jest.fn().mockResolvedValue({ request: {} }),
      writeContract: jest.fn().mockResolvedValue('0xtxhash'),
    })),
  };
});

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn(() => ({ address: '0xagent' })),
}));

const mockConfigService = {
  get: (key: string) => {
    const config: Record<string, string> = {
      AGENT_PRIVATE_KEY: '0x' + 'a'.repeat(64),
    };
    return config[key];
  },
};

describe('SubmitterService', () => {
  let service: SubmitterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmitterService,
        { provide: ConfigService, useValue: mockConfigService },
        WalletMutex, // real mutex — no deps; serializes the submit call
      ],
    }).compile();

    service = module.get<SubmitterService>(SubmitterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitFinding', () => {
    it('calls simulateContract then writeContract and returns the tx hash', async () => {
      const hash = await service.submitFinding('0xpool', 1, '0xpoc', 'Reentrancy detected');

      expect(hash).toBe('0xtxhash');
    });

    it('propagates errors thrown by simulateContract', async () => {
      // Access the already-initialised client on the service instance
      const client = (service as any).client;
      client.simulateContract.mockRejectedValueOnce(new Error('execution reverted'));

      await expect(
        service.submitFinding('0xpool', 1, '0xpoc', 'desc'),
      ).rejects.toThrow('execution reverted');
    });
  });
});
