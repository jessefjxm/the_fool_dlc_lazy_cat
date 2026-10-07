/*
 * ============================================================
 * 坚韧之猫 - 记录玩家受到过的伤害类型
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 检测玩家受到伤害。
 *   2. 获取本次伤害对应的 DamageType 注册 ID。
 *   3. 将伤害类型 ID 记录到：
 *        ForgeCaps."ageofmythology:traveller"
 *          .nbt_damage_type
 *   4. 已经记录过的伤害类型不会重复添加。
 *   5. 发现新的伤害类型时提示玩家。
 *
 * 例如：
 *
 *   玩家受到 minecraft:arrow 伤害：
 *
 *   nbt_damage_type:[
 *     {
 *       desc:"minecraft:arrow"
 *     }
 *   ]
 *
 * 玩家受到 alexcaves:nuke 伤害：
 *
 *   nbt_damage_type:[
 *     {
 *       desc:"alexcaves:nuke"
 *     }
 *   ]
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var Registries = Java.loadClass('net.minecraft.core.registries.Registries')

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[坚韧之猫] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_damage_type'

    /*
     * 收集进度的「目标」：模组自己的成就阈值
     *   CatOfTenacityItem 里 getBonusCount(player) >= 64
     */
    var GOAL_COUNT = 64

    /*
     * 收集进度的「上限」：本整合包内可记录的伤害类型总数，
     * 来源是模组手册该页 —— level.registryAccess() 的 DAMAGE_TYPE 注册表，实测 293。
     */
    var MAX_COUNT = 293

    /*
     * ------------------------------------------------------------
     * 悬停提示
     *
     * 实现放在 _悬停.js（global.hover）。
     * 伤害类型不是物品，所以用文字悬停显示它的关联信息。
     * ------------------------------------------------------------
     */
    function hoverText(component, lines) {
        try {
            return global.hover.hoverText(component, lines)
        } catch (e) {
            console.error('[坚韧之猫] 悬停工具不可用：' + e)
            return component
        }
    }

    function hoverItem(component, itemId, nbt) {
        try {
            return global.hover.hoverItem(component, itemId, nbt)
        } catch (e) {
            console.error('[坚韧之猫] 悬停工具不可用：' + e)
            return component
        }
    }

    /*
     * 本脚本对应的本体道具（脚本名 = 道具名）
     */
    var SCRIPT_ITEMS = {
        '坚韧之猫': 'ageofmythology:ageofmythology_cat_of_tenacity_item'
    }

    /*
     * 组装进度标记，三档：当前 / 目标 / 上限
     *   §8(§a261§7/§e64§7/§f293§8)
     */
    function progressText(collected, goal, max) {
        return ' §8(§a' + collected + '§7/§e' + goal + '§7/§f' + max + '§8)'
    }

    /*
     * ============================================================
     * 获取完整伤害类型 ID
     *
     * Minecraft 1.20.1 中：
     *
     *   DamageSource.type()
     *       ↓
     *   DamageType
     *
     * DamageType 本身没有 unwrapKey()。
     *
     * 因此通过当前世界的 DamageType Registry
     * 反向查询 DamageType 对应的 ResourceLocation。
     *
     * 例如：
     *
     *   minecraft:arrow
     *   minecraft:fall
     *   minecraft:magic
     *   alexcaves:nuke
     * ============================================================
     */
    function getDamageTypeId(player, damageSource) {
        try {
            var damageType = damageSource.type()
            if (damageType === null) return null

            var registryAccess = player.level.registryAccess()
            var damageTypeRegistry = registryAccess.registryOrThrow(Registries.DAMAGE_TYPE)
            var resourceLocation = damageTypeRegistry.getKey(damageType)

            if (resourceLocation === null) return null

            return String(resourceLocation)
        } catch (e) {
            console.error('[坚韧之猫] 获取完整伤害类型 ID 失败：' + e)
            return null
        }
    }

    /*
     * ============================================================
     * 向记录列表中添加一个伤害类型 ID
     *
     * 返回：
     *   true  = 成功新增
     *   false = 已经存在
     * ============================================================
     */
    function addRecord(list, damageTypeId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('desc') === damageTypeId) return false
            } catch (e) {
                console.error('[坚韧之猫] 读取已有伤害记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('desc', damageTypeId)
        list.add(tag)
        return true
    }

    /*
     * ============================================================
     * 处理玩家受到伤害
     * ============================================================
     */
    function process(player, damageSource) {
        if (player === null || damageSource === null) return

        /*
         * 获取本次伤害对应的完整 DamageType ID。
         */
        var damageTypeId = getDamageTypeId(player, damageSource)
        if (damageTypeId === null || damageTypeId.length === 0) return

        /*
         * ========================================================
         * 获取玩家 Traveller Capability NBT
         * ========================================================
         */
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound(TRAVELLER_CAP)

        /*
         * 获取已有记录。
         */
        var damageTypes = traveller.contains(RECORD_LIST) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

        /*
         * 已经记录过则直接结束。
         */
        if (!addRecord(damageTypes, damageTypeId)) return

        /*
         * ========================================================
         * 提示玩家
         * ========================================================
         */
        var damageTypeName = getDamageTypeName(damageTypeId)
        /*
         * 悬停：前缀挂本体道具；
         * 伤害类型名称挂文字悬停（ID + 死亡消息键）。
         */
        var prefix = hoverItem(Component.literal('§a[坚韧之猫]'), SCRIPT_ITEMS['坚韧之猫'], null)
        var message = Component.literal('').append(prefix).append(Component.literal(' §7发现新的伤害类型 §8» §f'))

        var lines = ['§7伤害类型 ID: §f' + damageTypeId]
        var idText = String(damageTypeId)
        var colon = idText.indexOf(':')
        if (colon > 0) {
            lines.push('§7死亡消息键: §fdeath.attack.' + idText.substring(colon + 1) + '§8（按原版命名规则）')
        }
        lines.push('§7当前已记录: §f' + damageTypes.size() + ' §7/ 上限 §f' + MAX_COUNT)
        lines.push('§7成就阈值: §e' + GOAL_COUNT + '§8（佩戴超过 ' + GOAL_COUNT + ' 种伤害类型时加成翻倍）')
        lines.push('§8悬停来源：伤害类型注册表')

        if (damageTypeName !== null) {
            message.append(hoverText(damageTypeName, lines))
        } else {
            message.append(hoverText(Component.literal(damageTypeId), lines))
        }

        message.append(Component.literal(' §8[' + damageTypeId + ']'))
        message.append(Component.literal(progressText(damageTypes.size(), GOAL_COUNT, MAX_COUNT)))
        player.tell(message)
        console.info('[坚韧之猫] 已记录新伤害类型：' + damageTypeId)

        /*
         * ========================================================
         * 保存玩家 NBT
         *
         * 显式写回：
         *   damageTypes
         *     ↓
         *   traveller
         *     ↓
         *   ForgeCaps
         *     ↓
         *   playerNbt
         * ========================================================
         */
        traveller.put(RECORD_LIST, damageTypes)
        forgeCaps.put(TRAVELLER_CAP, traveller)
        playerNbt.put('ForgeCaps', forgeCaps)
        player.setNbt(playerNbt)

        /*
         * 把新记录同步给客户端，让 UI 立即刷新。
         *
         * 必须放在 setNbt 之后：setNbt 会触发 deserializeNBT，
         * 把 NBT 灌回内存态，此时 sync 才有内容可发。
         */
        syncCapability(player)
    }

    /*
     * ============================================================
     * 把 capability 同步给客户端
     *
     * 模组的 UI / 属性只读内存态，且只在自身 tick 与 sync
     * 时机刷新；纯 NBT 写入后客户端数据包仍是旧的。
     * ============================================================
     */
    function syncCapability(player) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data !== null) data.sync(player)
        } catch (e) {
            console.error('[坚韧之猫] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    /*
     * ============================================================
     * 获取伤害类型本地化描述
     *
     * DamageType 的 death.attack.* 翻译实际上是死亡消息模板，
     * 并不是单纯的“伤害名称”。
     *
     * 例如：
     *
     *   %1$s被%2$s碾成了肉饼
     *
     * 这里会去除实体占位符，得到：
     *
     *   被碾成了肉饼
     *
     * 如果翻译键不存在，则返回 null，
     * 由调用处回退到伤害类型 ID。
     * ============================================================
     */
    function getDamageTypeName(damageTypeId) {
        try {
            var key = 'death.attack.' + damageTypeId.replace(':', '.')
            var component = Component.translatable(key)
            var text = String(component.getString())

            /*
             * 翻译键不存在时，Minecraft 会直接返回：
             *
             *   death.attack.xxx
             *
             * 这种情况不能当成本地化名称。
             */
            if (text === key) return null

            /*
             * 删除死亡消息中的实体占位符。
             *
             * %1$s = 死亡实体
             * %2$s = 攻击来源
             *
             * 同时兼容其他可能存在的 %3$s 等占位符。
             */
            text = text.replace(/%[0-9]+\$s/g, '').trim()

            if (text.length === 0) return null

            return Component.literal(text)
        } catch (e) {
            console.error('[坚韧之猫] 获取伤害类型本地化描述失败：' + e)
            return null
        }
    }

    /*
     * ============================================================
     * 玩家受到伤害时检测
     *
     * EntityEvents.hurt 会在实体受到伤害时触发。
     * 这里只处理玩家实体。
     * ============================================================
     */
    EntityEvents.hurt(function (event) {
        try {
            var player = event.getEntity()
            if (!player.isPlayer()) return
            process(player, event.getSource())
        } catch (e) {
            console.error('[坚韧之猫] 处理玩家伤害失败：' + e)
        }
    })
})()