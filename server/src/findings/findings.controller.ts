import { Controller, Get, Param } from '@nestjs/common';
import { FindingsService } from './findings.service';

@Controller('findings')
export class FindingsController {
  constructor(private readonly findingsService: FindingsService) {}

  @Get()
  findAll() {
    return this.findingsService.findAll();
  }

  @Get('contract/:address')
  findByContract(@Param('address') address: string) {
    return this.findingsService.findAllByContract(address);
  }
}
