// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev BUG 1 — upgradeTo() has no access control — anyone can point the proxy to a malicious impl
/// @dev BUG 2 — Storage slot collision between proxy admin and implementation state
/// @dev BUG 3 — initialize() has no initializer guard, can be re-called to reset owner
contract UnprotectedUpgrade {
    address public implementation;
    address public owner;
    uint256 public value;

    // BUG: no onlyOwner modifier
    function upgradeTo(address newImpl) external {
        implementation = newImpl;
    }

    // BUG: no initializer guard — re-entrancy via re-initialize
    function initialize(address _owner) external {
        owner = _owner; // can be called multiple times
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setValue(uint256 _value) external onlyOwner {
        value = _value;
    }

    // BUG: delegatecall to user-controlled address
    function delegateAction(address target, bytes calldata data) external {
        (bool ok,) = target.delegatecall(data); // arbitrary delegatecall
        require(ok);
    }

    // BUG: tx.origin auth — phishable
    function withdrawAll(address payable to) external {
        require(tx.origin == owner, "Not owner"); // should be msg.sender
        to.transfer(address(this).balance);
    }

    receive() external payable {}
}
