// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";

contract DiamondLoupeFacet {
    function facetAddress(bytes4 _selector) external view returns (address) {
        return LibDiamond.facetOf(_selector);
    }

    function facetAddresses(bytes4[] calldata _selectors) external view returns (address[] memory result) {
        result = new address[](_selectors.length);

        for (uint256 i = 0; i < _selectors.length; i++) {
            result[i] = LibDiamond.facetOf(_selectors[i]);
        }
    }
}