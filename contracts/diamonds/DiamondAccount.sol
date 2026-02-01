// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./LibDiamond.sol";

/// @notice Minimal Diamond-like proxy for selector routing (MVP).
/// Upgraded: uses shared storage (LibDiamond) + bubbles up delegatecall revert reason.
contract DiamondAccount {
    error FacetNotSet(bytes4 selector);

    constructor(address _owner) {
        LibDiamond.setOwner(_owner);
    }

    modifier onlyOwner() {
        LibDiamond.enforceIsOwner();
        _;
    }

    /// @notice Set routing for a function selector to a facet address.
    /// MVP management: owner-only.
    function setFacet(bytes4 selector, address facet) external onlyOwner {
        LibDiamond.setFacet(selector, facet);
    }

    /// @notice Debug helper: which facet is used for a selector.
    function facetOf(bytes4 selector) external view returns (address) {
        return LibDiamond.facetOf(selector);
    }

    /// @notice Owner getter (keeps ABI similar to `address public owner`).
    function owner() external view returns (address) {
        return LibDiamond.owner();
    }

    /// @notice Configure EntryPoint (useful soon for AA).
    function setEntryPoint(address ep) external onlyOwner {
        LibDiamond.setEntryPoint(ep);
    }

    function entryPoint() external view returns (address) {
        return LibDiamond.entryPoint();
    }

    fallback() external payable {
        address facet = LibDiamond.facetOf(msg.sig);
        if (facet == address(0)) revert FacetNotSet(msg.sig);
        _delegateToFacet(facet);
    }

    receive() external payable {}

    /// @dev Delegate the current calldata to `facet` and bubble up revert reason.
    function _delegateToFacet(address facet) internal {
        assembly ("memory-safe") {
            // Copy calldata to memory starting at position 0
            calldatacopy(0, 0, calldatasize())

            // Delegatecall into the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)

            // Copy returndata to memory
            returndatacopy(0, 0, returndatasize())

            // Bubble up revert reason or return data
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
