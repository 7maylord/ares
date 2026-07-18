import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);
  private readonly analyzerUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    const url = this.configService.get<string>('ANALYZER_SERVICE_URL');
    if (!url) {
      throw new Error('ANALYZER_SERVICE_URL environment variable is not defined');
    }
    this.analyzerUrl = url;
  }

  async analyzeContract(
    contractAddress: string,
    sourceCode?: string,
    bytecode?: string,
    rawSources?: Record<string, string>,
  ): Promise<any> {
    this.logger.log(`Sending contract ${contractAddress} to Python Analyzer...`);
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.analyzerUrl}/analyze`, {
          contract_address: contractAddress,
          source_code: sourceCode || null,
          bytecode: bytecode || null,
          sources: rawSources || null,
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Analysis failed for ${contractAddress}`, error);
      return null;
    }
  }

  async analyzeProject(contracts: { address: string; sourceCode?: string; bytecode?: string; rawSources?: Record<string, string> }[]): Promise<any> {
    this.logger.log(`Sending ${contracts.length}-contract project to Python Analyzer...`);
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.analyzerUrl}/analyze-project`, {
          contracts: contracts.map((c) => ({
            address: c.address,
            source_code: c.sourceCode || null,
            bytecode: c.bytecode || null,
            sources: c.rawSources || null,
          })),
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Project analysis failed', error);
      return null;
    }
  }
}
