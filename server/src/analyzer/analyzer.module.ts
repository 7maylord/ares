import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AnalyzerService } from './analyzer.service';

@Module({
  imports: [HttpModule],
  providers: [AnalyzerService],
  exports: [AnalyzerService]
})
export class AnalyzerModule {}
