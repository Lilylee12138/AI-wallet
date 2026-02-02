// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../interfaces/IEntryPointDeposit.sol";

/// @notice Facet to manage EntryPoint deposits for the account.
/// - depositToEntryPoint: anyone can deposit ETH to this account's EntryPoint balance
/// - withdrawDepositTo: only owner can withdraw from EntryPoint to an address
/// - getEntryPointDeposit: view current deposit balance on EntryPoint
contract EntryPointDepositFacet {
    error EntryPointNotSet();

    event DepositedToEntryPoint(address indexed entryPoint, uint256 amount);
    event WithdrawnFromEntryPoint(address indexed entryPoint, address indexed to, uint256 amount);

    function getEntryPointDeposit() external view returns (uint256) {
        address ep = LibDiamond.entryPoint();
        if (ep == address(0)) revert EntryPointNotSet();
        return IEntryPointDeposit(ep).balanceOf(address(this));
    }

    /// @notice Deposit msg.value to EntryPoint for this account.
    function depositToEntryPoint() external payable {
        address ep = LibDiamond.entryPoint();
        if (ep == address(0)) revert EntryPointNotSet();

        IEntryPointDeposit(ep).depositTo{value: msg.value}(address(this));
        emit DepositedToEntryPoint(ep, msg.value);
    }

    /// @notice Withdraw deposit from EntryPoint to `to`. Owner-only.
    function withdrawDepositTo(address payable to, uint256 amount) external {
        LibDiamond.enforceIsOwner();

        address ep = LibDiamond.entryPoint();
        if (ep == address(0)) revert EntryPointNotSet();

        IEntryPointDeposit(ep).withdrawTo(to, amount);
        emit WithdrawnFromEntryPoint(ep, to, amount);
    }
}
