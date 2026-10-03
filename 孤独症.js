/*
 * ============================================================
 * 孤独症 - 记录玩家听过的唱片与进入过的生物群系
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 玩家获得唱片时，记录对应唱片 ID。
 *   2. 玩家进入新的生物群系时，记录对应生物群系 ID。
 *   3. 两类记录统一写入：
 *
 *      ForgeCaps."ageofmythology:traveller".nbt_listened_discs*
 *      ForgeCaps."ageofmythology:traveller".nbt_listened_discs_size
 *
 * NBT 格式：
 *   nbt_listened_discs0: "perform:biome.minecraft.forest"
 *   nbt_listened_discs1: "listen:item.minecraft.music_disc_13"
 *   nbt_listened_discs_size: 2
 *
 * 注意：
 *   nbt_listened_discs_size 表示数组长度。
 *   nbt_listened_discs0、nbt_listened_discs1……表示具体记录。
 *
 * 生物群系记录格式：
 *   perform:biome.<biome_id>
 *
 * 唱片记录格式：
 *   listen:item.<item_id>
 *
 * 例如：
 *   minecraft:forest
 *       → perform:biome.minecraft.forest
 *
 *   minecraft:music_disc_13
 *       → listen:item.minecraft:music_disc_13
 *
 * 注意：
 *   这里不能使用标准 ListTag，因为 Age of Mythology 的数据结构
 *   是历史遗留设计，只能按照 nbt_listened_discs0、1、2……
 *   以及 nbt_listened_discs_size 的形式保存。
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_PREFIX = 'nbt_listened_discs'
    var RECORD_SIZE = 'nbt_listened_discs_size'
    var lastBiome = {}

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
     * 添加一条记录
     *
     * 数据格式：
     *   nbt_listened_discs<size> = value
     *   nbt_listened_discs_size = size + 1
     * ============================================================
     */
    function addRecord(player, value) {
        try {
            var data = getTraveller(player)
            var traveller = data.traveller
            if (hasRecord(traveller, value)) return false

            var size = traveller.contains(RECORD_SIZE, 3) ? traveller.getInt(RECORD_SIZE) : 0
            traveller.putString(RECORD_PREFIX + size, value)
            traveller.putInt(RECORD_SIZE, size + 1)
            saveTraveller(player, data)
            return true
        } catch (e) {
            console.error('[孤独症] 更新玩家 ForgeCaps 失败：' + e)
            return false
        }
    }

    /*
     * ============================================================
     * 获取 Item 本地化名称
     *
     * 不直接使用：
     *   item.minecraft.xxx
     *
     * 而是从 Minecraft 原生 Item 获取 descriptionId。
     *
     * 例如：
     *   minecraft:music_disc_13
     *       ↓
     *   item.minecraft.music_disc_13
     *       ↓
     *   Component.translatable()
     *
     * 这样可以兼容 Mod 自定义的 Item descriptionId。
     * ============================================================
     */
    function getItemName(item) {
        try {
            var mcItem = item.getItem()
            var translationKey = mcItem.getDescriptionId()
            return Component.translatable(translationKey)
        } catch (e) {
            console.error('[孤独症] 获取 Item 本地化名称失败：' + e)
            return Component.literal(String(item.getId()))
        }
    }

    /*
 * ============================================================
 * 获取唱片曲目本地化名称
 *
 * Minecraft 原版唱片的物品名称：
 *
 *   item.minecraft.music_disc_13
 *       → 音乐唱片
 *
 * 真正的曲目名称：
 *
 *   item.minecraft.music_disc_13.desc
 *       → C418 - 13
 *
 * 因此不能直接使用 Item#getDescriptionId()。
 * ============================================================
 */
    function getDiscName(item) {
        try {
            var itemId = String(item.getId())
            var parts = itemId.split(':')
            if (parts.length !== 2) return Component.literal(itemId)

            var translationKey = 'item.' + parts[0] + '.' + parts[1] + '.desc'
            return Component.translatable(translationKey)
        } catch (e) {
            console.error('[孤独症] 获取唱片曲目名称失败：' + e)
            return Component.literal(String(item.getId()))
        }
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
     *
     * Mod 生物群系同样适用：
     *   biomesoplenty:rainforest
     *       ↓
     *   biome.biomesoplenty.rainforest
     * ============================================================
     */
    function getBiomeName(biomeId) {
        try {
            var parts = String(biomeId).split(':')
            if (parts.length !== 2) return Component.literal(String(biomeId))
            return Component.translatable('biome.' + parts[0] + '.' + parts[1])
        } catch (e) {
            console.error('[孤独症] 获取 Biome 本地化名称失败：' + e)
            return Component.literal(String(biomeId))
        }
    }

    /*
     * ============================================================
     * 判断物品是否为唱片
     *
     * 使用 minecraft:music_discs Item Tag，
     * 不硬编码 music_disc_ 前缀。
     *
     * 因此 Mod 自定义唱片只要正确加入唱片 Tag，
     * 同样可以被识别。
     * ============================================================
     */
    function isMusicDisc(item) {
        try {
            return item !== null && !item.isEmpty() && item.hasTag('minecraft:music_discs')
        } catch (e) {
            return false
        }
    }

    /*
     * ============================================================
     * 处理玩家获得唱片
     *
     * 记录：
     *   listen:item.<item_id>
     *
     * 提示：
     *   [孤独症] 发现新的唱片 » <本地化名称> [item_id]
     * ============================================================
     */
    function processDisc(player, item) {
        if (!isMusicDisc(item)) return

        var itemId = String(item.getId())
        var value = 'listen:item.' + itemId
        if (!addRecord(player, value)) return

        var name = getDiscName(item)
        console.info('[孤独症] ★ 发现新的唱片：' + itemId)
        player.tell(Component.literal('§a[孤独症] §7发现新的唱片 §8» §f').append(name).append(Component.literal(' §8[' + itemId + ']')))
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
            console.error('[孤独症] 获取玩家生物群系失败：' + e)
            return null
        }
    }

    /*
     * ============================================================
     * 处理玩家进入新的生物群系
     *
     * 记录：
     *   perform:biome.<biome_id>
     *
     * 提示：
     *   [孤独症] 发现新的生物群系 » <本地化名称> [biome_id]
     * ============================================================
     */
    function processBiome(player) {
        var playerName = String(player.getName().getString())
        var biomeId = getBiomeId(player)
        if (biomeId === null) return
        if (lastBiome[playerName] === biomeId) return

        lastBiome[playerName] = biomeId

        var value = 'perform:biome.' + biomeId
        if (!addRecord(player, value)) return

        var name = getBiomeName(biomeId)
        console.info('[孤独症] ★ 发现新的生物群系：' + biomeId)
        player.tell(Component.literal('§a[孤独症] §7发现新的生物群系 §8» §f').append(name).append(Component.literal(' §8[' + biomeId + ']')))
    }

    /*
     * ============================================================
     * 玩家获得物品时检测唱片
     * ============================================================
     */
    PlayerEvents.inventoryChanged(function (event) {
        processDisc(event.getPlayer(), event.getItem())
    })

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