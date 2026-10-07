/*
 * ============================================================
 * 旅行者 - 记录玩家进入过的生物群系
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 玩家进入新的生物群系时，记录对应生物群系 ID。
 *   2. 每发现一个新的生物群系，一次性记录 7 个维度的数据。
 *   3. 数据统一写入：
 *
 *      ForgeCaps."ageofmythology:traveller".VisitBiomes*
 *      ForgeCaps."ageofmythology:traveller".VisitBiomesSize
 *
 * NBT 格式：
 *   VisitBiomes0: "lostcity:biome.minecraft.forest"
 *   VisitBiomes1: "otherside:biome.minecraft.forest"
 *   VisitBiomes2: "overworld:biome.minecraft.forest"
 *   VisitBiomes3: "the_aether:biome.minecraft.forest"
 *   VisitBiomes4: "the_end:biome.minecraft.forest"
 *   VisitBiomes5: "the_nether:biome.minecraft.forest"
 *   VisitBiomes6: "twilight_forest:biome.minecraft.forest"
 *   VisitBiomesSize: 7
 *
 * 注意：
 *   VisitBiomesSize 表示数组长度。
 *   VisitBiomes0、VisitBiomes1、VisitBiomes2……
 *   表示具体记录。
 *
 * 记录格式：
 *   <dimension>:biome.<biome_id>
 *
 * 例如：
 *   minecraft:forest
 *       ↓
 *   lostcity:biome.minecraft.forest
 *   otherside:biome.minecraft.forest
 *   overworld:biome.minecraft.forest
 *   the_aether:biome.minecraft.forest
 *   the_end:biome.minecraft.forest
 *   the_nether:biome.minecraft.forest
 *   twilight_forest:biome.minecraft.forest
 *
 * 维度：
 *   lostcity        失落城市
 *   otherside       异界（Deeper and Darker）
 *   overworld       主世界
 *   the_aether      天境（Aether）
 *   the_end         末地
 *   the_nether      下界
 *   twilight_forest 暮色森林
 *
 * 注意：
 *   这里不能使用标准 ListTag，因为 Age of Mythology 的数据结构
 *   是历史遗留设计，只能按照 VisitBiomes0、1、2……
 *   以及 VisitBiomesSize 的形式保存。
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_PREFIX = 'VisitBiomes'
    var RECORD_SIZE = 'VisitBiomesSize'
    var DIMENSIONS = ['lostcity', 'otherside', 'overworld', 'the_aether', 'the_end', 'the_nether', 'twilight_forest']
    var lastBiome = {}

    /*
     * 收集进度的「上限」：本整合包内可访问的生物群系总数，
     * 来源是模组手册该页 —— level.registryAccess() 的 BIOME 注册表条目数，实测 400。
     * 模组没给这一类设成就阈值，所以只显示「当前/上限」两档。
     */
    var MAX_BIOME = 400

    /*
     * 无目标值时的两档标记：当前 / 上限
     *   §8(§a261§7/§f400§8)
     */
    function progressText(collected, max) {
        return ' §8(§a' + collected + '§7/§f' + max + '§8)'
    }

    /*
     * ============================================================
     * 获取玩家 ForgeCaps.Traveller 数据
     * ============================================================
     */
    function getTraveller(player) {
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.contains('ForgeCaps', 10) ? playerNbt.getCompound('ForgeCaps') : new CompoundTag()
        var traveller = forgeCaps.contains(TRAVELLER_CAP, 10) ? forgeCaps.getCompound(TRAVELLER_CAP) : new CompoundTag()
        return { playerNbt: playerNbt, forgeCaps: forgeCaps, traveller: traveller }
    }

    /*
     * ============================================================
     * 保存 Traveller 数据回玩家 NBT
     * ============================================================
     */
    function saveTraveller(player, data) {
        data.forgeCaps.put(TRAVELLER_CAP, data.traveller)
        data.playerNbt.put('ForgeCaps', data.forgeCaps)
        player.setNbt(data.playerNbt)
    }

    /*
     * ============================================================
     * 检查记录是否已经存在
     * ============================================================
     */
    function hasRecord(traveller, value) {
        var size = traveller.contains(RECORD_SIZE, 3) ? traveller.getInt(RECORD_SIZE) : 0
        for (var i = 0; i < size; i++) {
            if (traveller.getString(RECORD_PREFIX + i) === value) return true
        }
        return false
    }

    /*
     * ============================================================
     * 获取 Biome 本地化名称
     *
     * Minecraft Biome 的标准翻译键为：
     *
     *   biome.<namespace>.<path>
     *
     * 例如：
     *   minecraft:forest
     *       ↓
     *   biome.minecraft.forest
     * ============================================================
     */
    function getBiomeName(biomeId) {
        try {
            var parts = String(biomeId).split(':')
            if (parts.length !== 2) return Component.literal(String(biomeId))
            return Component.translatable('biome.' + parts[0] + '.' + parts[1])
        } catch (e) {
            console.error('[旅行者] 获取 Biome 本地化名称失败：' + e)
            return Component.literal(String(biomeId))
        }
    }

    /*
     * ============================================================
     * 获取玩家当前所在生物群系 ID
     * ============================================================
     */
    function getBiomeId(player) {
        try {
            var holder = player.level.getBiome(player.blockPosition())
            var optionalKey = holder.unwrapKey()
            if (!optionalKey.isPresent()) return null
            return String(optionalKey.get().location())
        } catch (e) {
            console.error('[旅行者] 获取玩家生物群系失败：' + e)
            return null
        }
    }

    /*
     * ============================================================
     * 添加新的生物群系记录
     *
     * 每发现一个新的 Biome：
     *   一次性生成 7 个维度对应的记录。
     *
     * 例如：
     *   minecraft:forest
     *
     * 会生成：
     *   lostcity:biome.minecraft.forest
     *   otherside:biome.minecraft.forest
     *   overworld:biome.minecraft.forest
     *   the_aether:biome.minecraft.forest
     *   the_end:biome.minecraft.forest
     *   the_nether:biome.minecraft.forest
     *   twilight_forest:biome.minecraft.forest
     *
     * 已存在的记录不会重复添加。
     * ============================================================
     */
    function addBiomeRecords(player, biomeId) {
        try {
            var data = getTraveller(player)
            var traveller = data.traveller
            var size = traveller.contains(RECORD_SIZE, 3) ? traveller.getInt(RECORD_SIZE) : 0
            var added = 0
            var formattedBiomeId = biomeId.replace(':', '.')

            for (var i = 0; i < DIMENSIONS.length; i++) {
                var value = DIMENSIONS[i] + ':biome.' + formattedBiomeId
                if (hasRecord(traveller, value)) continue
                traveller.putString(RECORD_PREFIX + size, value)
                size++
                added++
            }

            if (added === 0) return false

            traveller.putInt(RECORD_SIZE, size)
            saveTraveller(player, data)
            return true
        } catch (e) {
            console.error('[旅行者] 更新玩家 ForgeCaps 失败：' + e)
            return false
        }
    }

    /*
     * ============================================================
     * 统计玩家已记录的不同生物群系个数
     *
     * 本表按「维度 + 群系」存 7 份记录（见 addBiomeRecords），
     * 所以不能直接取 size，必须把群系 id 去重后再数。
     * 记录格式：<维度>:biome.<命名空间>.<路径>
     * ============================================================
     */
    function countRecordedBiomes(player) {
        try {
            var data = getTraveller(player)
            var traveller = data.traveller
            var size = traveller.contains(RECORD_SIZE, 3) ? traveller.getInt(RECORD_SIZE) : 0
            var seen = {}
            for (var i = 0; i < size; i++) {
                try {
                    var raw = String(traveller.getString(RECORD_PREFIX + i))
                    var at = raw.indexOf('biome.')
                    if (at < 0) continue
                    var biomeId = raw.substring(at + 'biome.'.length)
                    seen[biomeId] = true
                } catch (e) { /* 跳过坏记录 */ }
            }
            return Object.keys(seen).length
        } catch (e2) {
            console.error('[旅行者] 统计已记录群系失败：' + e2)
            return 0
        }
    }

    /*
     * 处理玩家进入新的生物群系
     *
     * 每次发现新的 Biome：
     *   一次性记录 7 个维度。
     *
     * 提示：
     *   [旅行者] 发现新的生物群系 » <本地化名称> [biome_id]
     * ============================================================
     */
    function processBiome(player) {
        var playerName = String(player.getName().getString())
        var biomeId = getBiomeId(player)
        if (biomeId === null) return
        if (lastBiome[playerName] === biomeId) return

        lastBiome[playerName] = biomeId

        if (!addBiomeRecords(player, biomeId)) return

        var name = getBiomeName(biomeId)
        console.info('[旅行者] ★ 发现新的生物群系：' + biomeId)
        player.tell(Component.literal('§a[旅行者] §7发现新的生物群系 §8» §f').append(name).append(Component.literal(' §8[' + biomeId + ']')).append(Component.literal(progressText(countRecordedBiomes(player), MAX_BIOME))))
    }

    /*
     * ============================================================
     * 玩家 Tick：
     *   检测当前所在生物群系。
     *
     * 每 10 tick 检查一次，约 0.5 秒。
     * ============================================================
     */
    PlayerEvents.tick(function (event) {
        var player = event.getPlayer()
        if (player.level.isClientSide()) return
        if (player.age % 10 !== 0) return
        processBiome(player)
    })

    /*
     * ============================================================
     * 玩家退出服务器时清理内存缓存。
     * ============================================================
     */
    PlayerEvents.loggedOut(function (event) {
        var player = event.getPlayer()
        var playerName = String(player.getName().getString())
        delete lastBiome[playerName]
    })
})()