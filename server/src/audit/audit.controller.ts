import { Controller, Post, Body, BadRequestException, Logger } from '@nestjs/common';
import { AuditService } from './audit.service';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

@Controller('audit')
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  @Post()
  async audit(@Body() body: { contractAddress: string; txHash: string }) {
    const { contractAddress, txHash } = body;

    if (!contractAddress?.match(ADDRESS_RE)) {
      throw new BadRequestException('contractAddress must be a valid 0x Ethereum address');
    }
    if (!txHash) {
      throw new BadRequestException('txHash is required — send 2 MNT to the payment address first');
    }

    await this.auditService.verifyPayment(txHash);

    this.logger.log(`Payment verified for ${contractAddress}, starting audit`);
    return this.auditService.runAudit(contractAddress);
  }

  @Post('multi')
  async auditMulti(@Body() body: { contractAddresses: string[]; txHash: string }) {
    const { contractAddresses, txHash } = body;

    if (!Array.isArray(contractAddresses) || contractAddresses.length < 2) {
      throw new BadRequestException('contractAddresses must be an array of at least 2 addresses');
    }
    for (const addr of contractAddresses) {
      if (!addr?.match(ADDRESS_RE)) {
        throw new BadRequestException(`Invalid address: ${addr}`);
      }
    }
    if (!txHash) {
      throw new BadRequestException('txHash is required — send 2 MNT to the payment address first');
    }

    await this.auditService.verifyPayment(txHash);

    this.logger.log(`Payment verified, starting project audit for ${contractAddresses.length} contracts`);
    return this.auditService.runProjectAudit(contractAddresses);
  }
}
