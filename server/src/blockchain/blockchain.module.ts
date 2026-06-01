import { Module } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { ContractFetcherService } from './contract-fetcher.service';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { SubmitterModule } from '../submitter/submitter.module';

@Module({
  imports: [AnalyzerModule, SubmitterModule],
  providers: [BlockchainService, ContractFetcherService],
  exports: [ContractFetcherService],
})
export class BlockchainModule {}
