import { Module } from '@nestjs/common';
import { SubmitterService } from './submitter.service';

@Module({
  providers: [SubmitterService],
  exports: [SubmitterService]
})
export class SubmitterModule {}
