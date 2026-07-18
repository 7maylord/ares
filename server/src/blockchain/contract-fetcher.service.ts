import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { mantleSepoliaTestnet } from 'viem/chains';

export interface FetchedContract {
  sourceCode?: string;
  /** Raw per-file sources from Mantlescan multi-file JSON — present when isVerified and >1 file */
  rawSources?: Record<string, string>;
  bytecode?: string;
  isVerified: boolean;
  contractName?: string;
  compilerVersion?: string;
}

@Injectable()
export class ContractFetcherService {
  private readonly logger = new Logger(ContractFetcherService.name);
  private readonly mantlescanApiKey: string;
  private readonly rpcUrl: string;
  private readonly mantlescanApiUrl = 'https://api-sepolia.mantlescan.xyz/api';
  private client: ReturnType<typeof createPublicClient>;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('MANTLESCAN_API_KEY');
    if (!apiKey) {
      this.logger.warn('MANTLESCAN_API_KEY not set — verified source fetching will be disabled');
    }
    this.mantlescanApiKey = apiKey || '';

    const rpcUrl = this.configService.get<string>('MANTLE_SEPOLIA_RPC_URL');
    if (!rpcUrl) {
      throw new Error('MANTLE_SEPOLIA_RPC_URL environment variable is not defined');
    }
    this.rpcUrl = rpcUrl;

    this.client = createPublicClient({
      chain: mantleSepoliaTestnet,
      transport: http(this.rpcUrl),
    });
  }

  /**
   * Hybrid fetch: always retrieve both verified source (if available) AND
   * deployed bytecode from RPC. Having both lets the analyzer cross-validate
   * that the deployed bytecode actually matches the verified source — a real
   * attack vector where the two diverge.
   */
  async fetchContract(contractAddress: string): Promise<FetchedContract> {
    this.logger.log(`Fetching contract code for ${contractAddress}...`);

    // Always fetch bytecode from RPC regardless of verification status
    const [verifiedResult, bytecode] = await Promise.all([
      this.mantlescanApiKey ? this.fetchVerifiedSource(contractAddress) : Promise.resolve(null),
      this.fetchBytecodeFromRpc(contractAddress),
    ]);

    if (verifiedResult) {
      this.logger.log(
        `✅ Verified source for ${contractAddress} (${verifiedResult.contractName}) + bytecode`
      );
      return { ...verifiedResult, bytecode: bytecode ?? undefined };
    }

    if (bytecode && bytecode !== '0x') {
      this.logger.log(`📦 No verified source — raw bytecode only for ${contractAddress} (${bytecode.length} chars)`);
      return { bytecode, isVerified: false };
    }

    this.logger.warn(`⚠️ No code found at ${contractAddress} — may be an EOA, not a contract`);
    return { isVerified: false };
  }

  /**
   * Fetch verified source code from Mantlescan/Etherscan API
   */
  private async fetchVerifiedSource(contractAddress: string): Promise<FetchedContract | null> {
    try {
      const url = `${this.mantlescanApiUrl}?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${this.mantlescanApiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== '1' || !data.result || data.result.length === 0) {
        return null;
      }

      const result = data.result[0];

      // If SourceCode is empty, the contract is not verified
      if (!result.SourceCode || result.SourceCode === '') {
        return null;
      }

      // Handle multi-file source (Etherscan JSON format)
      let sourceCode = result.SourceCode;
      let rawSources: Record<string, string> | undefined;

      if (sourceCode.startsWith('{{')) {
        try {
          const inner = sourceCode.slice(1, -1);
          const parsed = JSON.parse(inner);
          const sources = parsed.sources || parsed;
          rawSources = Object.fromEntries(
            Object.entries(sources).map(([filename, content]: [string, any]) => [
              filename,
              typeof content === 'string' ? content : content.content,
            ])
          );
          // Concatenated string kept for LLM RAG (it reads text, not files)
          sourceCode = Object.entries(rawSources)
            .map(([filename, code]) => `// File: ${filename}\n${code}`)
            .join('\n\n');
        } catch {
          this.logger.warn('Failed to parse multi-file source, using raw');
        }
      }

      return {
        sourceCode,
        rawSources,
        isVerified: true,
        contractName: result.ContractName || undefined,
        compilerVersion: result.CompilerVersion || undefined,
      };
    } catch (error) {
      this.logger.error(`Mantlescan API error: ${error}`);
      return null;
    }
  }

  /**
   * Fetch raw deployed bytecode from the chain via RPC
   */
  private async fetchBytecodeFromRpc(contractAddress: string): Promise<string | null> {
    try {
      const bytecode = await this.client.getCode({
        address: contractAddress as `0x${string}`,
      });
      return bytecode || null;
    } catch (error) {
      this.logger.error(`RPC getCode error for ${contractAddress}: ${error}`);
      return null;
    }
  }
}
