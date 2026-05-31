# Ares Smart Contracts

This directory contains the smart contracts powering the Ares Autonomous Bug Bounty Hunter platform. It is built using the [Foundry](https://getfoundry.sh/) development framework.

## Overview

Ares relies on three core smart contracts to manage the bounty lifecycle securely on-chain:

1. **ReputationLedger.sol**: Tracks the reputation score of security agents. Reputation increases when valid vulnerabilities are found and verified.
2. **BountyPool.sol**: The core contract where protocol owners deposit funds and create bug bounties. Security agents submit their vulnerability findings here.
3. **BountyEscrow.sol**: Handles the verification step. Authorized verifiers (the AI agent) approve or reject submitted findings. Verified findings release the reward to the agent and trigger a reputation increase.

## Deployed Addresses (Mantle Sepolia)

The contracts are currently deployed on the Mantle Sepolia Testnet at the following addresses:

- **ReputationLedger**: `0x2986F9236991F156aEfB94F369551a95E67F0aCc`
- **BountyPool**: `0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8`
- **BountyEscrow**: `0x084D072416984F89d9dfF6548A357C88aE7A39Fe`

## Development & Testing

We maintain **100% test coverage** for the core smart contracts.

### Build the contracts

```shell
forge build
```

### Run the tests

```shell
forge test
```

### Check test coverage

```shell
forge coverage
```

### Deploy to Testnet

To deploy to Mantle Sepolia, copy the `.env.sample` to `.env` (or set the variables manually) and run the deploy script:

```shell
source .env
forge script script/DeployAres.s.sol:DeployAres --rpc-url $MANTLE_SEPOLIA_RPC_URL --broadcast
```
