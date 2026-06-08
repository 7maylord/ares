import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalysisProcessor } from '../queue/analysis.processor';
import { BountiesService } from '../bounties/bounties.service';

@Controller('analysis')
export class BlockchainController {
  constructor(
    private readonly analysisProcessor: AnalysisProcessor,
    private readonly bountiesService: BountiesService,
    private readonly configService: ConfigService,
  ) {}

  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger(@Body() dto: { targetContract: string }) {
    if (!dto.targetContract?.startsWith('0x')) {
      throw new BadRequestException('targetContract must be a valid 0x address');
    }

    const bountyId = Date.now() % 2_000_000_000;
    const poolAddress = this.configService.get<string>('POOL_ADDRESS') ?? '';

    await this.bountiesService.create({
      bountyId,
      targetContract: dto.targetContract,
      creator: 'manual-trigger',
      rewardAmount: '0',
      severityThreshold: 'Low',
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
      active: false,
      status: 'PENDING',
    });

    this.analysisProcessor
      .run({ bountyId, targetContract: dto.targetContract, poolAddress })
      .catch(() => {});

    return { bountyId, targetContract: dto.targetContract };
  }
}
