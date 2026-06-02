import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { AnalyzerService } from './analyzer.service';

const mockConfigService = {
  get: (key: string) =>
    key === 'ANALYZER_SERVICE_URL' ? 'http://localhost:8000' : undefined,
};

const mockHttpService = { post: jest.fn() };

describe('AnalyzerService', () => {
  let service: AnalyzerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyzerService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    service = module.get<AnalyzerService>(AnalyzerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeContract', () => {
    it('posts source_code and bytecode to the analyzer URL', async () => {
      const mockResponse: Partial<AxiosResponse> = {
        data: { status: 'success', vulnerabilities_found: 1, details: [{ title: 'Reentrancy' }] },
      };
      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await service.analyzeContract('0xabc', 'pragma solidity...', '0x6080');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:8000/analyze',
        {
          contract_address: '0xabc',
          source_code: 'pragma solidity...',
          bytecode: '0x6080',
        },
      );
      expect(result.vulnerabilities_found).toBe(1);
    });

    it('passes null for source_code and bytecode when not provided', async () => {
      const mockResponse: Partial<AxiosResponse> = {
        data: { status: 'success', vulnerabilities_found: 0, details: [] },
      };
      mockHttpService.post.mockReturnValue(of(mockResponse));

      await service.analyzeContract('0xabc');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ source_code: null, bytecode: null }),
      );
    });

    it('returns null and does not throw when the analyzer is unreachable', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

      const result = await service.analyzeContract('0xabc', 'source');

      expect(result).toBeNull();
    });
  });
});
