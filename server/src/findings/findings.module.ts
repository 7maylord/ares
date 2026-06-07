import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FindingEntity } from '../database/entities/finding.entity';
import { FindingsService } from './findings.service';
import { FindingsController } from './findings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FindingEntity])],
  providers: [FindingsService],
  controllers: [FindingsController],
  exports: [FindingsService],
})
export class FindingsModule {}
