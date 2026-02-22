// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A trivial facet used to test routing.
contract HelloFacet {
    function hello() external pure returns (string memory) {
        return "hello from facet";
    }
}