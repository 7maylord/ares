// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ReputationLedger} from "../src/ReputationLedger.sol";
import {BountyPool} from "../src/BountyPool.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

contract DeployAres is Script {
    function run() external {
        // Read private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);

        console.log("Deploying Ares contracts with deployer:", deployerAddress);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Reputation Ledger
        ReputationLedger ledger = new ReputationLedger(deployerAddress);
        console.log("ReputationLedger deployed at:", address(ledger));

        // 2. Deploy Bounty Pool
        BountyPool pool = new BountyPool(deployerAddress, address(ledger));
        console.log("BountyPool deployed at:", address(pool));

        // 3. Deploy Bounty Escrow
        BountyEscrow escrow = new BountyEscrow(deployerAddress, address(pool));
        console.log("BountyEscrow deployed at:", address(escrow));

        // 4. Wire them up
        pool.setEscrow(address(escrow));
        console.log("BountyPool escrow set to:", address(escrow));

        // 5. Grant JUDGE_ROLE to the pool so it can update agent reputations
        ledger.grantRole(ledger.JUDGE_ROLE(), address(pool));
        console.log("Granted JUDGE_ROLE on ReputationLedger to BountyPool");

        vm.stopBroadcast();
    }
}
