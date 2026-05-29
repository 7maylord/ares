import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);

  constructor(private readonly httpService: HttpService) {}

  async analyzeContract(contractAddress: string): Promise<any> {
    this.logger.log(`Sending contract ${contractAddress} to Python Analyzer...`);
    try {
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:8000/analyze', {
          contract_address: contractAddress,
          // Normally we fetch bytecode here and send it, omitting for brevity
          bytecode: '0x1234'
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Analysis failed for ${contractAddress}`, error);
      return null;
    }
  }
}
