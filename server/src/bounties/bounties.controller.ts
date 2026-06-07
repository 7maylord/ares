import { Controller, Get } from '@nestjs/common';
import { BountiesService } from './bounties.service';

@Controller('bounties')
export class BountiesController {
  constructor(private readonly bountiesService: BountiesService) {}

  @Get()
  findAll() {
    return this.bountiesService.findAll();
  }
}
