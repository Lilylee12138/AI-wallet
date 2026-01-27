// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title DiamondAccount - A minimal Diamond (proxy) pattern account
 */
contract DiamondAccount {
    error OnlyOwner();
    error FacetNotFound();
    error DelegateCallFailed();

    address public owner;
    
    // Mapping of function selectors to facet addresses
    mapping(bytes4 => address) public facets;

    constructor(address _owner) {
        owner = _owner;
    }

    /**
     * @notice Set a facet for a function selector
     */
    function setFacet(bytes4 selector, address facetAddress) external {
        if (msg.sender != owner) {
            revert OnlyOwner();
        }
        facets[selector] = facetAddress;
    }

    /**
     * @notice Fallback function that routes calls to appropriate facets
     */
    fallback() external payable {
        _delegateToFacet();
    }

    receive() external payable {}

    /**
     * @notice Delegates the call to the appropriate facet
     */
    function _delegateToFacet() private {
        bytes4 selector = msg.sig;
        address facet = facets[selector];
        
        if (facet == address(0)) {
            revert FacetNotFound();
        }

        // Call the facet with the full calldata
        (bool success, bytes memory result) = facet.delegatecall(msg.data);
        
        if (!success) {
            revert DelegateCallFailed();
        }
        
        // Return the result
        assembly {
            return(add(result, 0x20), mload(result))
        }
    }
}
