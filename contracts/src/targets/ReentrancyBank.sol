// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev BUG 1 — Reentrancy: balance updated AFTER external call in withdraw()
/// @dev BUG 2 — Anyone can drain the contract via donateAndDrain() with no access control
contract ReentrancyBank {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // BUG: CEI pattern violated — sends ETH before zeroing balance
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        balances[msg.sender] -= amount; // too late
    }

    // BUG: no access control — anyone can call
    function emergencyDrain(address to) external {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok);
    }

    receive() external payable {}
}
