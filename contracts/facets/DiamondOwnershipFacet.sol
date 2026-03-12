// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";

interface IERC173 {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function owner() external view returns (address);
    function transferOwnership(address _newOwner) external;
}

contract DiamondOwnershipFacet is IERC173 {
    function owner() external view override returns (address) {
        return LibDiamond.owner();
    }

    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsOwner();
        require(_newOwner != address(0), "DiamondOwnershipFacet: zero owner");

        address previousOwner = LibDiamond.owner();
        LibDiamond.setOwner(_newOwner);

        emit OwnershipTransferred(previousOwner, _newOwner);
    }
}