import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BountyEntity } from '../database/entities/bounty.entity';
import { BountiesService } from './bounties.service';
import { BountiesController } from './bounties.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BountyEntity])],
  providers: [BountiesService],
  controllers: [BountiesController],
  exports: [BountiesService],
})
export class BountiesModule {}
