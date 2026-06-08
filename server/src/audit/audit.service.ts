import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, parseEther, getAddress } from 'viem';
import { mantleSepoliaTestnet } from 'viem/chains';
import { ContractFetcherService } from '../blockchain/contract-fetcher.service';
import { AnalyzerService } from '../analyzer/analyzer.service';

// Minimum payment: 2 MNT (Mantle native token)
const MIN_PAYMENT = parseEther('2');

export interface AuditReport {
  contractAddress: string;
  isVerified: boolean;
  contractName?: string;
  vulnerabilities_found: number;
  details: {
    title: string;
    severity: string;
    category: string;
    location?: string;
    description: string;
    poc_sketch?: string;
    remediation?: string;
  }[];
  analyzedAt: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly client: ReturnType<typeof createPublicClient>;
  private readonly paymentAddress: `0x${string}`;
  private readonly usedTxHashes = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly contractFetcherService: ContractFetcherService,
    private readonly analyzerService: AnalyzerService,
  ) {
    const rpcUrl = this.configService.get<string>('MANTLE_SEPOLIA_RPC_URL') ?? 'https://rpc.sepolia.mantle.xyz';
    this.client = createPublicClient({
      chain: mantleSepoliaTestnet,
      transport: http(rpcUrl),
    });

    this.paymentAddress = getAddress(
      this.configService.get<string>('PAYMENT_ADDRESS') ?? '0x2986F9236991F156aEfB94F369551a95E67F0aCc',
    );
  }

  async verifyPayment(txHash: string): Promise<void> {
    if (!txHash?.match(/^0x[0-9a-fA-F]{64}$/)) {
      throw new BadRequestException('txHash must be a valid 0x transaction hash (64 hex chars)');
    }

    if (this.usedTxHashes.has(txHash)) {
      throw new BadRequestException('This transaction has already been used for an audit');
    }

    let tx: Awaited<ReturnType<typeof this.client.getTransaction>>;
    try {
      tx = await this.client.getTransaction({ hash: txHash as `0x${string}` });
    } catch {
      throw new BadRequestException('Transaction not found on Mantle Sepolia');
    }

    if (!tx) {
      throw new BadRequestException('Transaction not found on Mantle Sepolia');
    }

    if (!tx.to || getAddress(tx.to) !== this.paymentAddress) {
      throw new BadRequestException(
        `Payment must be sent to ${this.paymentAddress}`,
      );
    }

    if (tx.value < MIN_PAYMENT) {
      throw new BadRequestException(
        `Insufficient payment — minimum is 2 MNT, received ${tx.value.toString()} wei`,
      );
    }

    // Mark as used to prevent replay
    this.usedTxHashes.add(txHash);
  }

  async runAudit(contractAddress: string): Promise<AuditReport> {
    this.logger.log(`Running audit for ${contractAddress}`);

    const fetched = await this.contractFetcherService.fetchContract(contractAddress);

    if (!fetched.sourceCode && !fetched.bytecode) {
      return {
        contractAddress,
        isVerified: false,
        vulnerabilities_found: 0,
        details: [],
        analyzedAt: new Date().toISOString(),
      };
    }

    const result = await this.analyzerService.analyzeContract(
      contractAddress,
      fetched.sourceCode,
      fetched.bytecode,
    );

    return {
      contractAddress,
      isVerified: fetched.isVerified,
      contractName: fetched.contractName,
      vulnerabilities_found: result?.vulnerabilities_found ?? 0,
      details: result?.details ?? [],
      analyzedAt: new Date().toISOString(),
    };
  }
}
