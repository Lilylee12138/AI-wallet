// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title HelloFacet - A simple facet that returns "hello from facet"
 */
contract HelloFacet {
    /**
     * @notice Returns a hello message
     */
    function hello() external pure returns (string memory) {
        return "hello from facet";
    }
}
