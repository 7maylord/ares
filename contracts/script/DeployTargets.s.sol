// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {BountyPool} from "../src/BountyPool.sol";
import {ReentrancyBank} from "../src/targets/ReentrancyBank.sol";
import {InsecureStaking} from "../src/targets/InsecureStaking.sol";
import {NaiveAMM} from "../src/targets/NaiveAMM.sol";
import {UnprotectedUpgrade} from "../src/targets/UnprotectedUpgrade.sol";

/// @notice Deploys the four vulnerable target contracts and creates a bounty
///         on the existing BountyPool for each one.
///
/// Usage:
///   forge script script/DeployTargets.s.sol \
///     --rpc-url https://rpc.sepolia.mantle.xyz \
///     --broadcast \
///     --private-key $PRIVATE_KEY
///
/// Required env vars:
///   PRIVATE_KEY      — deployer / bounty creator private key
///   POOL_ADDRESS     — deployed BountyPool address
contract DeployTargets is Script {
    // 1 MNT reward per bounty, deadline 30 days, min severity High
    uint256 constant REWARD    = 1 ether;
    uint8   constant SEVERITY  = 2; // Severity.High
    uint256 constant DAYS_30   = 30 days;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address poolAddress = vm.envAddress("POOL_ADDRESS");
        BountyPool pool = BountyPool(payable(poolAddress));

        console.log("Deployer       :", deployer);
        console.log("BountyPool     :", poolAddress);

        vm.startBroadcast(pk);

        uint256 deadline = block.timestamp + DAYS_30;

        // ── 1. ReentrancyBank ──────────────────────────────────────────────
        ReentrancyBank bank = new ReentrancyBank();
        console.log("ReentrancyBank :", address(bank));

        uint256 id0 = pool.createBounty{value: REWARD}(
            address(bank), REWARD, SEVERITY, deadline, new address[](0)
        );
        console.log("Bounty #%d created for ReentrancyBank", id0);

        // ── 2. InsecureStaking ────────────────────────────────────────────
        InsecureStaking staking = new InsecureStaking();
        console.log("InsecureStaking:", address(staking));

        uint256 id1 = pool.createBounty{value: REWARD}(
            address(staking), REWARD, SEVERITY, deadline, new address[](0)
        );
        console.log("Bounty #%d created for InsecureStaking", id1);

        // ── 3. NaiveAMM ───────────────────────────────────────────────────
        // Deploy two dummy ERC-20s for the AMM (address(0) for test — slot collision safe)
        NaiveAMM amm = new NaiveAMM(address(0), address(0));
        console.log("NaiveAMM       :", address(amm));

        uint256 id2 = pool.createBounty{value: REWARD}(
            address(amm), REWARD, SEVERITY, deadline, new address[](0)
        );
        console.log("Bounty #%d created for NaiveAMM", id2);

        // ── 4. UnprotectedUpgrade ─────────────────────────────────────────
        UnprotectedUpgrade proxy = new UnprotectedUpgrade();
        console.log("UnprotectedUpgrade:", address(proxy));

        uint256 id3 = pool.createBounty{value: REWARD}(
            address(proxy), REWARD, SEVERITY, deadline, new address[](0)
        );
        console.log("Bounty #%d created for UnprotectedUpgrade", id3);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Summary ===");
        console.log("ReentrancyBank    :", address(bank),   "Bounty #%d", id0);
        console.log("InsecureStaking   :", address(staking),"Bounty #%d", id1);
        console.log("NaiveAMM          :", address(amm),    "Bounty #%d", id2);
        console.log("UnprotectedUpgrade:", address(proxy),  "Bounty #%d", id3);
    }
}
