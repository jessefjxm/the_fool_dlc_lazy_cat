/*
 * ============================================================
 * 探险之狐 - 记录玩家进入过的 Structure
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 检测玩家当前所在位置是否进入 Structure。
 *   2. Structure ID 使用 Minecraft 注册表中的完整 ID。
 *   3. 不考虑玩家 Y 高度，只判断 Structure 的 X/Z 水平范围。
 *   4. 同一位置如果存在多个 Structure，则全部记录。
 *   5. 新 Structure 写入：
 *
 *        ForgeCaps."ageofmythology:traveller"
 *          .nbt_explor_structure
 *
 *   6. NBT 格式：
 *
 *        nbt_explor_structure: [{
 *            desc: "dungeons_arise:mushroom_village"
 *        }, {
 *            desc: "red:dark_tower"
 *        }]
 *
 *   7. 已经记录过的 Structure 不会重复添加。
 *   8. 发现新的 Structure 时提示玩家。
 *   9. 提示使用 Structure 的本地化名称，并保留完整 ID。
 *
 * 检测方式：
 *   - 每 5 tick 检查一次玩家。
 *   - 检查玩家所在区块周围 3×3 区块。
 *   - 使用 StructureStart 的 BoundingBox。
 *   - 只判断 X/Z，不判断 Y。
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var Registries = Java.loadClass('net.minecraft.core.registries.Registries')
    var Component = Java.loadClass('net.minecraft.network.chat.Component')

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[探险之狐] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var CHECK_INTERVAL = 5
    var RADIUS = 1

    /*
     * --------------------------------------------------------
     * 判断 Structure 是否已经记录
     * --------------------------------------------------------
     */
    function hasRecord(list, structureId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                if (list.getCompound(i).getString('desc') === structureId) return true
            } catch (e) {
                console.error('[探险之狐] 读取已有 Structure 记录失败 #' + i + '：' + e)
            }
        }
        return false
    }

    /*
     * --------------------------------------------------------
     * 添加 Structure 记录
     * --------------------------------------------------------
     */
    function addRecord(list, structureId) {
        if (hasRecord(list, structureId)) return false
        var tag = new CompoundTag()
        tag.putString('desc', structureId)
        list.add(tag)
        return true
    }

    /*
     * --------------------------------------------------------
     * 获取 Structure ID
     *
     * 从当前世界 RegistryAccess 获取 Structure 注册表，
     * 避免直接访问 BuiltInRegistries.STRUCTURE。
     * --------------------------------------------------------
     */
    function getStructureId(level, structure) {
        try {
            var registry = level.registryAccess().registryOrThrow(Registries.STRUCTURE)
            var key = registry.getKey(structure)
            if (key === null) return null
            var id = String(key.toString())
            return id.length > 0 ? id : null
        } catch (e) {
            console.error('[探险之狐] 获取 Structure ID 失败：' + e)
            return null
        }
    }

    /*
     * --------------------------------------------------------
     * 获取 Structure 本地化名称
     *
     * 使用：
     *   structure.<namespace>.<path>
     *
     * 例如：
     *   minecraft:village
     *     -> structure.minecraft.village
     *
     * 如果模组没有提供对应翻译，则 Minecraft 会显示
     * 未翻译的键，因此最终提示仍然会保留完整 ID。
     * --------------------------------------------------------
     */
    function getStructureName(structureId) {
        try {
            var key = 'structure.' + structureId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[探险之狐] 获取 Structure 本地化名称失败：' + e)
            return Component.literal(structureId)
        }
    }

    /*
     * --------------------------------------------------------
     * 判断玩家 X/Z 是否位于 Structure 的水平范围
     *
     * 注意：
     *   不检查 Y。
     * --------------------------------------------------------
     */
    function containsXZ(box, x, z) {
        return x >= box.minX() && x <= box.maxX() && z >= box.minZ() && z <= box.maxZ()
    }

    /*
     * --------------------------------------------------------
     * 检查一个区块中的全部 Structure
     *
     * 不使用 entrySet().iterator()，避免 Rhino 访问
     * Collections$UnmodifiableMap 内部 EntrySet。
     *
     * 不使用 Java.from()，因为当前 KubeJS 版本没有该 API。
     *
     * 使用 values().toArray() 转换为数组。
     * --------------------------------------------------------
     */
    function scanChunk(level, chunk, x, z, found) {
        try {
            var starts = chunk.getAllStarts()
            if (starts === null) return

            var values = starts.values().toArray()

            for (var i = 0; i < values.length; i++) {
                try {
                    var start = values[i]
                    if (start === null || !start.isValid()) continue

                    var box = start.getBoundingBox()
                    if (box === null || !containsXZ(box, x, z)) continue

                    var structure = start.getStructure()
                    if (structure === null) continue

                    var structureId = getStructureId(level, structure)
                    if (structureId !== null) found[structureId] = true
                } catch (e) {
                    console.error('[探险之狐] 读取 StructureStart 失败 #' + i + '：' + e)
                }
            }
        } catch (e) {
            console.error('[探险之狐] 检查区块 Structure 失败：' + e)
        }
    }

    /*
     * --------------------------------------------------------
     * 获取玩家当前位置的全部 Structure
     *
     * 检查玩家所在区块周围 3×3 区块：
     *
     *   ■ ■ ■
     *   ■ 让 ■
     *   ■ ■ ■
     *
     * 这样可以识别 Structure 起点位于相邻区块、
     * 但 Structure 本体延伸到玩家当前位置的情况。
     * --------------------------------------------------------
     */
    function findStructures(player) {
        var found = {}

        try {
            var level = player.level
            var x = Math.floor(player.getX())
            var z = Math.floor(player.getZ())
            var chunkX = x >> 4
            var chunkZ = z >> 4

            for (var dx = -RADIUS; dx <= RADIUS; dx++) {
                for (var dz = -RADIUS; dz <= RADIUS; dz++) {
                    try {
                        var chunk = level.getChunk(chunkX + dx, chunkZ + dz)
                        if (chunk !== null) scanChunk(level, chunk, x, z, found)
                    } catch (e) {
                        console.error('[探险之狐] 获取区块失败 (' + (chunkX + dx) + ', ' + (chunkZ + dz) + ')：' + e)
                    }
                }
            }
        } catch (e) {
            console.error('[探险之狐] 获取玩家当前位置 Structure 失败：' + e)
        }

        return found
    }

    /*
     * --------------------------------------------------------
     * 处理玩家
     * --------------------------------------------------------
     */
    function process(player) {
        if (player === null) return

        var found = findStructures(player)
        var structureIds = Object.keys(found)
        if (structureIds.length === 0) return

        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound('ageofmythology:traveller')
        var structures = traveller.contains('nbt_explor_structure') ? traveller.getList('nbt_explor_structure', 10) : new ListTag()
        var changed = false

        for (var i = 0; i < structureIds.length; i++) {
            var structureId = structureIds[i]

            if (addRecord(structures, structureId)) {
                var name = getStructureName(structureId)
                var message = Component.literal('§a[探险之狐] §7发现新的结构 §8» §f').append(name).append(Component.literal(' §8[' + structureId + ']'))
                player.tell(message)
                changed = true
            }
        }

        if (changed) {
            traveller.put('nbt_explor_structure', structures)
            player.setNbt(playerNbt)

            /*
             * 把新记录同步给客户端，让 UI 立即刷新。
             *
             * 必须放在 setNbt 之后：setNbt 会触发 deserializeNBT，
             * 把 NBT 灌回内存态，此时 sync 才有内容可发。
             */
            syncCapability(player)
        }
    }

    /*
     * --------------------------------------------------------
     * 把 capability 同步给客户端
     *
     * 模组的 UI / 属性只读内存态，且只在自身 tick 与 sync
     * 时机刷新；纯 NBT 写入后客户端数据包仍是旧的。
     * --------------------------------------------------------
     */
    function syncCapability(player) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data !== null) data.sync(player)
        } catch (e) {
            console.error('[探险之狐] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    /*
     * --------------------------------------------------------
     * 玩家 Tick
     *
     * 每 5 tick 检查一次。
     * --------------------------------------------------------
     */
    PlayerEvents.tick(function (event) {
        var player = event.getPlayer()
        if (player.level.isClientSide()) return
        if (player.age % CHECK_INTERVAL !== 0) return
        process(player)
    })
})()