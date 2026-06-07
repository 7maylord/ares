import { Controller, Get } from '@nestjs/common';
import { FindingsService } from './findings.service';

@Controller('findings')
export class FindingsController {
  constructor(private readonly findingsService: FindingsService) {}

  @Get()
  findAll() {
    return this.findingsService.findAll();
  }
}
