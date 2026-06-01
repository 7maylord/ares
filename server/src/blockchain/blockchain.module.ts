import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BlockchainService } from './blockchain.service';
import { ContractFetcherService } from './contract-fetcher.service';
import { FeedbackService } from './feedback.service';
import { QueueService } from '../queue/queue.service';
import { AnalysisProcessor } from '../queue/analysis.processor';
import { QueueModule } from '../queue/queue.module';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { SubmitterModule } from '../submitter/submitter.module';

@Module({
  imports: [HttpModule, QueueModule, AnalyzerModule, SubmitterModule],
  providers: [BlockchainService, ContractFetcherService, FeedbackService, QueueService, AnalysisProcessor],
  exports: [ContractFetcherService],
})
export class BlockchainModule {}
