import { Test, TestingModule } from '@nestjs/testing';
import { SubmitterService } from './submitter.service';

describe('SubmitterService', () => {
  let service: SubmitterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SubmitterService],
    }).compile();

    service = module.get<SubmitterService>(SubmitterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
