// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title GoldMinerLevelCatalog
/// @notice 链上关卡目录的最小可信存储。
/// @dev 这个合约只保存某个 level/version 是否启用，以及与之绑定的
///      content hash、challenge seed、goal 等配置真值。排行榜、read model
///      和链下 replay 校验都依赖这里的启用版本，但不会把更高层展示文案写进链上。
contract GoldMinerLevelCatalog {
    error InvalidContentHash();
    error InvalidChallengeSeed();
    error InvalidLevelId();
    error InvalidLevelVersion();
    error InvalidOrder();
    error InvalidOwner();
    error LevelNotFound();
    error Unauthorized();

    struct LevelConfig {
        bytes32 levelId;
        uint32 version;
        bytes32 contentHash;
        uint32 order;
        bool enabled;
        bytes32 challengeSeed;
    }

    struct CatalogPointer {
        bytes32 levelId;
        uint32 version;
    }

    address public owner;

    mapping(bytes32 => mapping(uint32 => LevelConfig)) private _levels;
    mapping(bytes32 => mapping(uint32 => bool)) private _exists;
    mapping(bytes32 => uint256) private _catalogIndexByKey;
    CatalogPointer[] private _catalogPointers;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event LevelUpserted(
        bytes32 indexed levelId,
        uint32 indexed version,
        bytes32 contentHash,
        uint32 order,
        bool enabled,
        bytes32 challengeSeed
    );
    event LevelEnabledUpdated(bytes32 indexed levelId, uint32 indexed version, bool enabled);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }

        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function upsertLevel(LevelConfig calldata config) external onlyOwner {
        _validateConfig(config);

        _levels[config.levelId][config.version] = config;
        _exists[config.levelId][config.version] = true;

        bytes32 compositeKey = _compositeKey(config.levelId, config.version);
        // upsert 允许覆盖同一个关卡版本的配置真值，但不会改变枚举槽位。
        // 这样外部索引器可以稳定依赖 catalog pointer 顺序，而不必处理删除/重排。
        if (_catalogIndexByKey[compositeKey] == 0) {
            _catalogPointers.push(CatalogPointer({levelId: config.levelId, version: config.version}));
            _catalogIndexByKey[compositeKey] = _catalogPointers.length;
        }

        emit LevelUpserted(
            config.levelId,
            config.version,
            config.contentHash,
            config.order,
            config.enabled,
            config.challengeSeed
        );
    }

    function setLevelEnabled(bytes32 levelId, uint32 version, bool enabled) external onlyOwner {
        if (!_exists[levelId][version]) {
            revert LevelNotFound();
        }

        _levels[levelId][version].enabled = enabled;
        emit LevelEnabledUpdated(levelId, version, enabled);
    }

    function getLevel(bytes32 levelId, uint32 version) external view returns (LevelConfig memory) {
        if (!_exists[levelId][version]) {
            revert LevelNotFound();
        }

        return _levels[levelId][version];
    }

    function getCatalog() external view returns (LevelConfig[] memory) {
        // catalog 返回的是当前所有 pointer 的快照副本，而不是 storage 引用。
        // 调用方必须把它当作只读枚举结果，不能假设链上存在额外排序或过滤语义。
        LevelConfig[] memory levels = new LevelConfig[](_catalogPointers.length);
        for (uint256 index = 0; index < _catalogPointers.length; index += 1) {
            CatalogPointer memory pointer = _catalogPointers[index];
            levels[index] = _levels[pointer.levelId][pointer.version];
        }

        for (uint256 i = 1; i < levels.length; i += 1) {
            LevelConfig memory current = levels[i];
            uint256 j = i;
            while (j > 0 && levels[j - 1].order > current.order) {
                levels[j] = levels[j - 1];
                j -= 1;
            }
            levels[j] = current;
        }

        return levels;
    }

    function levelExists(bytes32 levelId, uint32 version) external view returns (bool) {
        return _exists[levelId][version];
    }

    function isLevelEnabled(bytes32 levelId, uint32 version) external view returns (bool) {
        return _exists[levelId][version] && _levels[levelId][version].enabled;
    }

    function _validateConfig(LevelConfig calldata config) private pure {
        // catalog 层只维护最基础的不变量：关卡标识、版本、hash、seed、顺序
        // 都必须是有效非零值。更高层的内容一致性由链下 manifest/replay 继续保证。
        if (config.levelId == bytes32(0)) {
            revert InvalidLevelId();
        }
        if (config.version == 0) {
            revert InvalidLevelVersion();
        }
        if (config.contentHash == bytes32(0)) {
            revert InvalidContentHash();
        }
        if (config.order == 0) {
            revert InvalidOrder();
        }
        if (config.challengeSeed == bytes32(0)) {
            revert InvalidChallengeSeed();
        }
    }

    function _compositeKey(bytes32 levelId, uint32 version) private pure returns (bytes32) {
        return keccak256(abi.encode(levelId, version));
    }
}
