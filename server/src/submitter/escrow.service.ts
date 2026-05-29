import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mantleTestnet } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private client: any;
  private escrowAbi: any;
  private readonly ESCROW_ADDRESS: string;

  constructor(private configService: ConfigService) {
    const pk = this.configService.get<string>('AGENT_PRIVATE_KEY');
    if (!pk) {
      throw new Error('AGENT_PRIVATE_KEY environment variable is not defined');
    }
    const account = privateKeyToAccount(pk as `0x${string}`);

    this.client = createWalletClient({
      account,
      chain: mantleTestnet,
      transport: http(),
    }).extend(publicActions);

    const escrowAddress = this.configService.get<string>('ESCROW_ADDRESS');
    if (!escrowAddress) {
      throw new Error('ESCROW_ADDRESS environment variable is not defined');
    }
    this.ESCROW_ADDRESS = escrowAddress;

    const abiPath = path.join(__dirname, '..', 'abi', 'BountyEscrow.abi.json');
    if (fs.existsSync(abiPath)) {
      this.escrowAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }
  }

  /**
   * In the MVP, the Ares agent acts as its own off-chain oracle.
   * After the Python analyzer validates a PoC locally, we auto-verify the finding.
   */
  async verifyFinding(findingId: number): Promise<string> {
    this.logger.log(`Auto-verifying finding ${findingId} on escrow ${this.ESCROW_ADDRESS}`);
    try {
      const { request } = await this.client.simulateContract({
        address: this.ESCROW_ADDRESS as `0x${string}`,
        abi: this.escrowAbi,
        functionName: 'verify',
        args: [BigInt(findingId)],
      });
      const hash = await this.client.writeContract(request);
      this.logger.log(`Finding ${findingId} verified in tx: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error(`Failed to verify finding ${findingId}`, error);
      throw error;
    }
  }

  async rejectFinding(findingId: number): Promise<string> {
    this.logger.log(`Rejecting finding ${findingId} on escrow ${this.ESCROW_ADDRESS}`);
    try {
      const { request } = await this.client.simulateContract({
        address: this.ESCROW_ADDRESS as `0x${string}`,
        abi: this.escrowAbi,
        functionName: 'reject',
        args: [BigInt(findingId)],
      });
      const hash = await this.client.writeContract(request);
      this.logger.log(`Finding ${findingId} rejected in tx: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error(`Failed to reject finding ${findingId}`, error);
      throw error;
    }
  }
}
