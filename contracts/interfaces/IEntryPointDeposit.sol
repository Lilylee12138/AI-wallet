// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IEntryPointDeposit {
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
}
