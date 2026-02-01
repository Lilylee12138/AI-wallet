// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";

/// @notice Minimal execution facet: allows the wallet to call external contracts.
/// MVP permission: only owner can execute.
contract ExecutionFacet {
    event Executed(address indexed target, uint256 value, bytes data, bytes result);

    error TargetZero();
    error CallFailed(bytes reason);

    function execute(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        // MVP: owner-only. Later: authorize via EntryPoint / ValidationFacet.
        LibDiamond.enforceIsOwnerOrEntryPoint();

        if (target == address(0)) revert TargetZero();

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert CallFailed(ret);

        emit Executed(target, value, data, ret);
        return ret;
    }
}
