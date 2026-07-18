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

    const poolAddress = this.configService.get<string>('POOL_ADDRESS') ?? '';

    // Reuse an existing on-chain bounty for this target if one exists,
    // so the finding is submitted against the real bountyId and reward.
    const existing = await this.bountiesService.findByTargetContract(dto.targetContract);
    let bountyId: number;

    if (existing) {
      bountyId = existing.bountyId;
      await this.bountiesService.updateByBountyId(bountyId, { status: 'PENDING' });
    } else {
      bountyId = Date.now() % 2_000_000_000;
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
    }

    this.analysisProcessor
      .run({ bountyId, targetContract: dto.targetContract, poolAddress })
      .catch(() => {});

    return { bountyId, targetContract: dto.targetContract };
  }

  @Post('trigger-multi')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerMulti(@Body() dto: { targetContracts: string[] }) {
    if (!Array.isArray(dto.targetContracts) || dto.targetContracts.length < 2) {
      throw new BadRequestException('targetContracts must be an array of at least 2 addresses');
    }
    for (const addr of dto.targetContracts) {
      if (!addr?.startsWith('0x')) {
        throw new BadRequestException(`Invalid address: ${addr}`);
      }
    }

    const primaryContract = dto.targetContracts[0];
    const poolAddress = this.configService.get<string>('POOL_ADDRESS') ?? '';
    const existing = await this.bountiesService.findByTargetContract(primaryContract);
    let bountyId: number;

    if (existing) {
      bountyId = existing.bountyId;
      await this.bountiesService.updateByBountyId(bountyId, { status: 'PENDING' });
    } else {
      bountyId = Date.now() % 2_000_000_000;
      await this.bountiesService.create({
        bountyId,
        targetContract: primaryContract,
        creator: 'manual-trigger',
        rewardAmount: '0',
        severityThreshold: 'Low',
        deadline: new Date(Date.now() + 86_400_000).toISOString(),
        active: false,
        status: 'PENDING',
      });
    }

    this.analysisProcessor
      .runProject(bountyId, dto.targetContracts, poolAddress)
      .catch(() => {});

    return { bountyId, targetContracts: dto.targetContracts };
  }
}
