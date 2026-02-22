// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A tiny mock router for demo purposes.
/// It does NOT do real swaps. It only emits an event and returns a mocked output amount.
contract MockSwapRouter {
    event MockSwap(address indexed caller, address indexed to, uint256 ethIn, uint256 outAmount);

    function swapEthToMockUsdt(address to) external payable returns (uint256 outAmount) {
        // pretend 1 ETH = 3000 USDT
        outAmount = msg.value * 3000;
        emit MockSwap(msg.sender, to, msg.value, outAmount);
    }
}
