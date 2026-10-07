/*
 * ============================================================
 * 贪食之狐 - 记录玩家发现的矿物方块
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 玩家破坏矿物方块时记录。（获得方块的判定有问题，放弃了）
 *   2. 自动识别 Forge/Common 的矿石标签。
 *   3. 支持其他 Mod 添加的矿物方块。
 *   4. 已记录的矿物不会重复添加。
 *   5. 新发现矿物时提示玩家。
 *
 * 判断方式：
 *
 *   方块属于以下任意标签即可：
 *
 *     forge:ores
 *     c:ores
 *
 * NBT：
 *
 *   ForgeCaps."ageofmythology:traveller"
 *       .nbt_gluttony_fox_eat_block
 *
 * 数据格式：
 *
 *   [
 *     {
 *       desc: "block.minecraft.diamond_ore"
 *     }
 *   ]
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[贪食之狐] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    /*
     * ------------------------------------------------------------
     * 常量
     * ------------------------------------------------------------
     */

    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_gluttony_fox_eat_block'

    /*
     * 收集进度的「目标」：模组自己的成就阈值
     *   FoxOfGluttonyItem 里 getBonusCount(player) >= 32
     */
    var GOAL_COUNT = 32

    /*
     * 收集进度的「上限」：本整合包内可吞噬的方块总数，
     * 来源是模组手册该页 —— forge:ores 方块标签成员 53 + 空气 1 = 54。
     */
    var MAX_COUNT = 54

    /*
     * 组装进度标记，三档：当前 / 目标 / 上限
     *   §8(§a261§7/§e32§7/§f54§8)
     */
    function progressText(collected, goal, max) {
        return ' §8(§a' + collected + '§7/§e' + goal + '§7/§f' + max + '§8)'
    }

    /*
     * 支持的矿石标签。
     *
     * forge:ores：
     *   Forge 生态常用矿石标签。
     *
     * c:ores：
     *   Common Tags / Fabric-Forge 兼容生态常用矿石标签。
     *
     * 两者任意一个命中即可。
     */
    var ORE_TAGS = ['forge:ores', 'c:ores']

    /*
     * ------------------------------------------------------------
     * 获取方块本地化名称
     *
     * 例如：
     *   minecraft:diamond_ore
     *     -> block.minecraft.diamond_ore
     *
     * 如果模组没有提供对应翻译，Minecraft 会显示
     * 未翻译的键，因此最终提示仍然可以保留完整 ID。
     * ------------------------------------------------------------
     */
    function getBlockName(blockId) {
        try {
            var key = 'block.' + blockId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[贪食之狐] 获取方块本地化名称失败：' + e)
            return Component.literal(blockId)
        }
    }

    /*
     * ------------------------------------------------------------
     * 判断方块是否属于矿物
     * ------------------------------------------------------------
     *
     * KubeJS Block 包装器提供 hasTag()。
     *
     * 不直接判断方块 ID，因此可以自动兼容：
     *
     *   minecraft:diamond_ore
     *   minecraft:deepslate_diamond_ore
     *   mod:xxx_ore
     *   mod:deepslate_xxx_ore
     *   以及其他 Mod 注册的矿石。
     */
    function isOreBlock(block) {
        if (block === null) return false

        for (var i = 0; i < ORE_TAGS.length; i++) {
            try {
                if (block.hasTag(ORE_TAGS[i])) return true
            } catch (e) {
                console.error('[贪食之狐] 检查矿石标签失败：' + ORE_TAGS[i] + '：' + e)
            }
        }

        return false
    }

    /*
     * ------------------------------------------------------------
     * 向记录列表添加一条矿物记录
     * ------------------------------------------------------------
     *
     * desc 保存的是方块的 translation key。
     *
     * 例如：
     *
     *   block.minecraft.diamond_ore
     *   block.minecraft.deepslate_diamond_ore
     *
     * 返回：
     *
     *   true  = 新增成功
     *   false = 已经存在
     */
    function addRecord(list, desc) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('desc') === desc) return false
            } catch (e) {
                console.error('[贪食之狐] 读取已有矿物记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('desc', desc)
        list.add(tag)
        return true
    }

    /*
     * ------------------------------------------------------------
     * 获取 / 创建 Traveller Capability NBT
     * ------------------------------------------------------------
     */
    function getRecordList(playerNbt) {
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound(TRAVELLER_CAP)
        var list = traveller.contains(RECORD_LIST) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

        return { forgeCaps: forgeCaps, traveller: traveller, list: list }
    }

    /*
     * ------------------------------------------------------------
     * 保存矿物记录
     * ------------------------------------------------------------
     */
    function recordBlock(player, block) {
        if (player === null || block === null) return

        /*
         * 不是矿物方块直接结束。
         */
        if (!isOreBlock(block)) return

        /*
         * 获取方块 ID。
         *
         * 例如：
         *   minecraft:diamond_ore
         */
        var blockId = String(block.id)

        /*
         * 获取方块 translation key。
         *
         * 例如：
         *   block.minecraft.diamond_ore
         *
         * 这是本脚本最终写入 NBT 的 desc。
         */
        var desc

        try {
            /*
             * KubeJS Block 包装器的 translationKey。
             */
            desc = String(block.getBlockState().getBlock().getDescriptionId())
        } catch (e) {
            /*
             * 极端情况下如果无法获取 DescriptionId，
             * 使用标准 Minecraft translation key 规则作为后备。
             */
            desc = 'block.' + blockId.replace(':', '.')
            console.error('[贪食之狐] 获取方块描述键失败：' + blockId + '，使用后备值：' + desc + '，错误：' + e)
        }

        /*
         * 获取玩家 NBT。
         */
        var playerNbt = player.getNbt()
        var data = getRecordList(playerNbt)

        /*
         * 已经记录过则不再写入。
         */
        if (!addRecord(data.list, desc)) return

        /*
         * 写回记录列表。
         */
        data.traveller.put(RECORD_LIST, data.list)

        /*
         * 写回 Traveller。
         */
        data.forgeCaps.put(TRAVELLER_CAP, data.traveller)

        /*
         * 写回 ForgeCaps。
         */
        playerNbt.put('ForgeCaps', data.forgeCaps)

        /*
         * 保存玩家 NBT。
         */
        player.setNbt(playerNbt)

        /*
         * 把新记录同步给客户端，让 UI 立即刷新。
         *
         * 必须放在 setNbt 之后：setNbt 会触发 deserializeNBT，
         * 把 NBT 灌回内存态，此时 sync 才有内容可发。
         */
        syncCapability(player)

        /*
         * 提示玩家。
         */
        var blockName = getBlockName(blockId)
        var message = Component.literal('§a[贪食之狐] §7发现新的矿物方块 §8» §f').append(blockName).append(Component.literal(' §8[' + blockId + ']')).append(Component.literal(progressText(data.list.size(), GOAL_COUNT, MAX_COUNT)))
        player.tell(message)

        console.log('[贪食之狐] 玩家 ' + String(player.username) + ' 发现矿物：' + blockId + '，desc=' + desc)
    }

    /*
     * ------------------------------------------------------------
     * 把 capability 同步给客户端
     *
     * 模组的 UI / 属性只读内存态，且只在自身 tick 与 sync
     * 时机刷新；纯 NBT 写入后客户端数据包仍是旧的。
     * ------------------------------------------------------------
     */
    function syncCapability(player) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data !== null) data.sync(player)
        } catch (e) {
            console.error('[贪食之狐] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    /*
     * ------------------------------------------------------------
     * 玩家破坏矿物方块
     * ------------------------------------------------------------
     *
     * BlockEvents.broken 是 KubeJS 原生的方块破坏事件。
     *
     * event.block：
     *   被破坏的方块
     *
     * event.player：
     *   破坏方块的玩家
     */
    BlockEvents.broken(function (event) {
        try {
            if (event.player === null) return
            recordBlock(event.player, event.block)
        } catch (e) {
            console.error('[贪食之狐] 处理方块破坏事件失败：' + e)
        }
    })
})()