import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { BlockchainService } from './blockchain.service';
import { BlockchainController } from './blockchain.controller';
import { AgentController } from './agent.controller';
import { ContractFetcherService } from './contract-fetcher.service';
import { FeedbackService } from './feedback.service';
import { AnalysisProcessor } from '../queue/analysis.processor';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { SubmitterModule } from '../submitter/submitter.module';
import { BountiesModule } from '../bounties/bounties.module';
import { FindingsModule } from '../findings/findings.module';
import { EventsModule } from '../events/events.module';

// FUTURE: re-enable QueueModule + QueueService when adding Redis
// import { QueueModule } from '../queue/queue.module';
// import { QueueService } from '../queue/queue.service';

@Module({
  imports: [HttpModule, AnalyzerModule, SubmitterModule, BountiesModule, FindingsModule, EventsModule],
  controllers: [BlockchainController, AgentController],
  providers: [BlockchainService, ContractFetcherService, FeedbackService, AnalysisProcessor],
  exports: [ContractFetcherService],
})
export class BlockchainModule {}
