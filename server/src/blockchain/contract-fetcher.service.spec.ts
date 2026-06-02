import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ContractFetcherService, FetchedContract } from './contract-fetcher.service';

const mockConfig = (overrides: Record<string, string | undefined> = {}) => ({
  get: (key: string) => {
    const defaults: Record<string, string> = {
      MANTLE_SEPOLIA_RPC_URL: 'https://rpc.sepolia.mantle.xyz',
      MANTLESCAN_API_KEY: 'test-api-key',
    };
    return overrides[key] !== undefined ? overrides[key] : defaults[key];
  },
});

describe('ContractFetcherService', () => {
  let service: ContractFetcherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractFetcherService,
        { provide: ConfigService, useValue: mockConfig() },
      ],
    }).compile();

    service = module.get<ContractFetcherService>(ContractFetcherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fetchContract', () => {
    it('returns verified source + bytecode when Mantlescan succeeds', async () => {
      const mockSource = 'pragma solidity ^0.8.0; contract Foo {}';
      const mockBytecode = '0x6080604052';

      jest.spyOn(service as any, 'fetchVerifiedSource').mockResolvedValue({
        sourceCode: mockSource,
        isVerified: true,
        contractName: 'Foo',
        compilerVersion: '0.8.20',
      });
      jest.spyOn(service as any, 'fetchBytecodeFromRpc').mockResolvedValue(mockBytecode);

      const result = await service.fetchContract('0x1234');

      expect(result.isVerified).toBe(true);
      expect(result.sourceCode).toBe(mockSource);
      expect(result.bytecode).toBe(mockBytecode);
    });

    it('returns bytecode only when contract is not verified on Mantlescan', async () => {
      const mockBytecode = '0x6080604052deadbeef';

      jest.spyOn(service as any, 'fetchVerifiedSource').mockResolvedValue(null);
      jest.spyOn(service as any, 'fetchBytecodeFromRpc').mockResolvedValue(mockBytecode);

      const result = await service.fetchContract('0xunverified');

      expect(result.isVerified).toBe(false);
      expect(result.sourceCode).toBeUndefined();
      expect(result.bytecode).toBe(mockBytecode);
    });

    it('returns empty result when no code found (EOA address)', async () => {
      jest.spyOn(service as any, 'fetchVerifiedSource').mockResolvedValue(null);
      jest.spyOn(service as any, 'fetchBytecodeFromRpc').mockResolvedValue('0x');

      const result = await service.fetchContract('0xeoa');

      expect(result.isVerified).toBe(false);
      expect(result.sourceCode).toBeUndefined();
      expect(result.bytecode).toBeUndefined();
    });

    it('skips Mantlescan when API key is not set', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ContractFetcherService,
          { provide: ConfigService, useValue: mockConfig({ MANTLESCAN_API_KEY: undefined }) },
        ],
      }).compile();
      const noKeyService = module.get<ContractFetcherService>(ContractFetcherService);

      const mockBytecode = '0x6080';
      jest.spyOn(noKeyService as any, 'fetchVerifiedSource').mockResolvedValue(null);
      jest.spyOn(noKeyService as any, 'fetchBytecodeFromRpc').mockResolvedValue(mockBytecode);

      const result = await noKeyService.fetchContract('0xaddr');

      expect(result.bytecode).toBe(mockBytecode);
      expect(result.isVerified).toBe(false);
    });
  });
});
