// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Shared diamond storage + core roles.
/// All facets and DiamondAccount will read/write via this library.
/// This prevents storage collisions when adding more facets later.
library LibDiamond {
    // IMPORTANT: This slot must be unique and stable forever.
    bytes32 internal constant DIAMOND_STORAGE_POSITION =
        keccak256("ai-wallet.diamond.storage.v1");

    struct DiamondStorage {
        // selector => facet address
        mapping(bytes4 => address) facetOf;

        // roles / config (skeleton; will be expanded later)
        address owner;
        address entryPoint;
        address riskOracle;
        address daoManager;
    }

    function diamondStorage() internal pure returns (DiamondStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }

    /* ===================== Owner ===================== */

    function setOwner(address newOwner) internal {
        diamondStorage().owner = newOwner;
    }

    function owner() internal view returns (address) {
        return diamondStorage().owner;
    }

    function enforceIsOwner() internal view {
        require(msg.sender == diamondStorage().owner, "LibDiamond: not owner");
    }

    /* ===================== Facet routing ===================== */

    function setFacet(bytes4 selector, address facet) internal {
        diamondStorage().facetOf[selector] = facet;
    }

    function facetOf(bytes4 selector) internal view returns (address) {
        return diamondStorage().facetOf[selector];
    }

    /* ===================== EntryPoint role (for AA) ===================== */

    function setEntryPoint(address ep) internal {
        diamondStorage().entryPoint = ep;
    }

    function entryPoint() internal view returns (address) {
        return diamondStorage().entryPoint;
    }

    function enforceIsEntryPoint() internal view {
        require(msg.sender == diamondStorage().entryPoint, "LibDiamond: not entryPoint");
    }

    /* ===================== Risk Oracle role (Phase 3) ===================== */

    function setRiskOracle(address oracle) internal {
        diamondStorage().riskOracle = oracle;
    }

    function riskOracle() internal view returns (address) {
        return diamondStorage().riskOracle;
    }

    function enforceIsRiskOracle() internal view {
        require(msg.sender == diamondStorage().riskOracle, "LibDiamond: not riskOracle");
    }

    /* ===================== DAO manager role (later) ===================== */

    function setDaoManager(address mgr) internal {
        diamondStorage().daoManager = mgr;
    }

    function daoManager() internal view returns (address) {
        return diamondStorage().daoManager;
    }

    function enforceIsDaoManager() internal view {
        require(msg.sender == diamondStorage().daoManager, "LibDiamond: not daoManager");
    }

    function enforceIsOwnerOrEntryPoint() internal view {
        DiamondStorage storage ds = diamondStorage();
        // allow: owner, EntryPoint, or the Diamond itself (self-call from another facet)
        if (msg.sender != ds.owner && msg.sender != ds.entryPoint && msg.sender != address(this)) {
            revert("LibDiamond: not owner or entryPoint");
        }
    }
}
