// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";

contract DiamondCutFacet {
    enum FacetCutAction {
        Add,
        Replace,
        Remove
    }

    struct FacetCut {
        address facetAddress;
        FacetCutAction action;
        bytes4[] functionSelectors;
    }

    event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata);

    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external {
        LibDiamond.enforceIsOwner();

        for (uint256 i = 0; i < _diamondCut.length; i++) {
            FacetCutAction action = _diamondCut[i].action;
            address facetAddress = _diamondCut[i].facetAddress;
            bytes4[] calldata selectors = _diamondCut[i].functionSelectors;

            require(selectors.length > 0, "DiamondCutFacet: empty selectors");

            if (action == FacetCutAction.Add || action == FacetCutAction.Replace) {
                require(facetAddress != address(0), "DiamondCutFacet: zero facet");

                for (uint256 j = 0; j < selectors.length; j++) {
                    LibDiamond.setFacet(selectors[j], facetAddress);
                }
            } else if (action == FacetCutAction.Remove) {
                for (uint256 j = 0; j < selectors.length; j++) {
                    LibDiamond.setFacet(selectors[j], address(0));
                }
            } else {
                revert("DiamondCutFacet: invalid action");
            }
        }

        emit DiamondCut(_diamondCut, _init, _calldata);

        // lightweight optional init call
        if (_init != address(0)) {
            (bool success, bytes memory err) = _init.delegatecall(_calldata);
            require(success, string(err));
        }
    }
}