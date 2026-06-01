import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BlockchainService } from './blockchain.service';
import { ContractFetcherService } from './contract-fetcher.service';
import { FeedbackService } from './feedback.service';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { SubmitterModule } from '../submitter/submitter.module';

@Module({
  imports: [HttpModule, AnalyzerModule, SubmitterModule],
  providers: [BlockchainService, ContractFetcherService, FeedbackService],
  exports: [ContractFetcherService],
})
export class BlockchainModule {}
