// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ScriptBase} from "../src/foundry/Vm.sol";
import {GoldMinerLevelCatalog} from "../src/GoldMinerLevelCatalog.sol";
import {GoldMinerScoreboard} from "../src/GoldMinerScoreboard.sol";

/// @notice 本地/部署脚本：把 `config/ranked-levels.json` 中的关卡批量写入链上 catalog，
/// 并在需要时同步更新当前排位 challenge 指针。
///
/// 约束：
/// - 关卡真值源是 JSON 配置与合约 catalog 的组合，而不是脚本内部硬编码；
/// - 只有 `boardKind == ranked` 且 `isCurrent == true` 的条目才会推动 scoreboard
///   的 current challenge 指针；
/// - 脚本本身不校验 replay 语义，只负责把已确定的配置写到链上。
contract RegisterLevels is ScriptBase {
    struct LevelRegistration {
        string boardKind;
        bytes32 levelId;
        uint32 version;
        uint32 order;
        bytes32 contentHash;
        bytes32 challengeSeed;
        bool enabled;
        bool isCurrent;
    }

    function run(address catalogAddress, address scoreboardAddress) external {
        LevelRegistration[] memory levels = loadLevelsFromConfig();

        applyRegistrations(levels, catalogAddress, scoreboardAddress);
    }

    function loadLevelsFromConfig() public view returns (LevelRegistration[] memory levels) {
        string memory levelsJson =
            vm.readFile(string.concat(vm.projectRoot(), "/config/ranked-levels.json"));
        uint256 levelCount = _countLevels(levelsJson);
        levels = new LevelRegistration[](levelCount);

        for (uint256 index = 0; index < levelCount; index += 1) {
            levels[index] = _parseLevel(levelsJson, index);
        }
    }

    function applyRegistrations(
        LevelRegistration[] memory levels,
        address catalogAddress,
        address scoreboardAddress
    ) public {
        vm.startBroadcast();
        _applyRegistrations(levels, catalogAddress, scoreboardAddress);
        vm.stopBroadcast();
    }

    function applyRegistrationsWithoutBroadcast(
        LevelRegistration[] memory levels,
        address catalogAddress,
        address scoreboardAddress
    ) public {
        _applyRegistrations(levels, catalogAddress, scoreboardAddress);
    }

    function _applyRegistrations(
        LevelRegistration[] memory levels,
        address catalogAddress,
        address scoreboardAddress
    ) private {
        GoldMinerLevelCatalog catalog = GoldMinerLevelCatalog(catalogAddress);
        GoldMinerScoreboard scoreboard = GoldMinerScoreboard(scoreboardAddress);

        for (uint256 index = 0; index < levels.length; index += 1) {
            LevelRegistration memory level = levels[index];
            // catalog 是关卡配置的最小可信真相源；脚本逐条 upsert，保持链上 config
            // 与本地 JSON 对齐，而不是尝试在链上做额外派生。
            catalog.upsertLevel(
                GoldMinerLevelCatalog.LevelConfig({
                    levelId: level.levelId,
                    version: level.version,
                    contentHash: level.contentHash,
                    order: level.order,
                    enabled: level.enabled,
                    challengeSeed: level.challengeSeed
                })
            );

            if (
                level.isCurrent &&
                keccak256(bytes(level.boardKind)) == keccak256(bytes("ranked"))
            ) {
                // 当前排位 challenge 指针只允许指向 ranked board；脚本不会把 adventure
                // 或其他 board kind 混入 scoreboard 当前 challenge。
                scoreboard.setCurrentRankedChallenge(level.levelId, level.version);
            }
        }
    }

    function _countLevels(string memory levelsJson) private pure returns (uint256 count) {
        bytes memory raw = bytes(levelsJson);
        bytes memory needle = bytes("\"levelId\"");

        if (raw.length < needle.length) {
            return 0;
        }

        for (uint256 index = 0; index <= raw.length - needle.length; index += 1) {
            bool matches = true;
            for (uint256 offset = 0; offset < needle.length; offset += 1) {
                if (raw[index + offset] != needle[offset]) {
                    matches = false;
                    break;
                }
            }

            if (matches) {
                count += 1;
                index += needle.length - 1;
            }
        }
    }

    function _parseLevel(string memory levelsJson, uint256 index)
        private
        pure
        returns (LevelRegistration memory)
    {
        string memory prefix = string.concat(".[", _toString(index), "]");
        return LevelRegistration({
            boardKind: abi.decode(vm.parseJson(levelsJson, string.concat(prefix, ".boardKind")), (string)),
            levelId: _stringToBytes32(
                abi.decode(vm.parseJson(levelsJson, string.concat(prefix, ".levelId")), (string))
            ),
            version: abi.decode(vm.parseJson(levelsJson, string.concat(prefix, ".version")), (uint32)),
            order: abi.decode(vm.parseJson(levelsJson, string.concat(prefix, ".order")), (uint32)),
            contentHash: abi.decode(
                vm.parseJson(levelsJson, string.concat(prefix, ".contentHash")),
                (bytes32)
            ),
            challengeSeed: abi.decode(
                vm.parseJson(levelsJson, string.concat(prefix, ".challengeSeed")),
                (bytes32)
            ),
            enabled: abi.decode(vm.parseJson(levelsJson, string.concat(prefix, ".enabled")), (bool)),
            isCurrent: abi.decode(vm.parseJson(levelsJson, string.concat(prefix, ".isCurrent")), (bool))
        });
    }

    function _stringToBytes32(string memory value) private pure returns (bytes32 result) {
        bytes memory raw = bytes(value);
        if (raw.length == 0) {
            return bytes32(0);
        }

        assembly {
            result := mload(add(raw, 32))
        }
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) {
            return "0";
        }

        uint256 digits;
        uint256 remaining = value;
        while (remaining != 0) {
            digits += 1;
            remaining /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }

        return string(buffer);
    }
}
