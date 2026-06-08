import { Controller, Post, Body, BadRequestException, Logger } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  @Post()
  async audit(@Body() body: { contractAddress: string; txHash: string }) {
    const { contractAddress, txHash } = body;

    if (!contractAddress?.match(/^0x[0-9a-fA-F]{40}$/)) {
      throw new BadRequestException('contractAddress must be a valid 0x Ethereum address');
    }
    if (!txHash) {
      throw new BadRequestException('txHash is required — send 2 MNT to the payment address first');
    }

    // Verify payment on-chain before running the audit
    await this.auditService.verifyPayment(txHash);

    this.logger.log(`Payment verified for ${contractAddress}, starting audit`);
    return this.auditService.runAudit(contractAddress);
  }
}
