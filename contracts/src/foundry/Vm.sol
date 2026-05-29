// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface Vm {
    function addr(uint256 privateKey) external returns (address keyAddr);
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function startBroadcast() external;
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
    function readFile(string calldata path) external view returns (string memory);
    function parseJson(string calldata json) external pure returns (bytes memory);
    function parseJson(string calldata json, string calldata key) external pure returns (bytes memory);
    function serializeAddress(string calldata objectKey, string calldata valueKey, address value)
        external
        returns (string memory);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value)
        external
        returns (string memory);
    function serializeString(string calldata objectKey, string calldata valueKey, string calldata value)
        external
        returns (string memory);
    function store(address target, bytes32 slot, bytes32 value) external;
    function writeJson(string calldata json, string calldata path) external;
    function projectRoot() external view returns (string memory);
}

abstract contract ScriptBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
