// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../libs/LibNonce.sol";

/// @notice Minimal nonce facet for AA readiness.
/// MVP:
/// - getNonce() view current nonce
/// - useNonce() increments nonce (owner-only for now)
///
/// Later (AA):
/// - ValidationFacet will read and increment nonce during validateUserOp.
contract NonceFacet {
    event NonceUsed(uint256 prevNonce, uint256 newNonce);

    function getNonce() external view returns (uint256) {
        return LibNonce.get();
    }

    /// @notice Increment nonce. MVP: only owner can call.
    function useNonce() external returns (uint256 prevNonce) {
        LibDiamond.enforceIsOwner();
        prevNonce = LibNonce.increment();
        emit NonceUsed(prevNonce, prevNonce + 1);
    }
}
