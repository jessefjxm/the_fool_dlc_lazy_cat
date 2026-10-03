/*
 * ============================================================
 * 酿态之猫 - 记录玩家获得过的 Buff / 状态效果
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 检测玩家当前获得的全部 MobEffect。
 *   2. 获取 MobEffect 对应的完整注册 ID。
 *   3. 将 Buff ID 转换为 Minecraft 效果本地化键格式：
 *
 *        minecraft:resistance
 *          ↓
 *        effect.minecraft.resistance
 *
 *   4. 将转换后的 ID 记录到：
 *        ForgeCaps."ageofmythology:traveller"
 *          .nbt_effect_type
 *   5. 已经记录过的效果不会重复添加。
 *   6. 发现新的效果时提示玩家。
 *
 * 例如：
 *
 *   玩家获得 minecraft:resistance：
 *
 *   nbt_effect_type:[
 *     {
 *       desc:"effect.minecraft.resistance"
 *     }
 *   ]
 *
 *   玩家获得 minecraft:regeneration：
 *
 *   nbt_effect_type:[
 *     {
 *       desc:"effect.minecraft.resistance"
 *     },
 *     {
 *       desc:"effect.minecraft.regeneration"
 *     }
 *   ]
 *
 *   玩家获得模组效果：
 *
 *   irons_spellbooks:haste
 *     ↓
 *   effect.irons_spellbooks.haste
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
            console.error('[酿态之猫] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_effect_type'

    /*
     * ============================================================
     * 获取完整 MobEffect 注册 ID
     *
     * 例如：
     *
     *   minecraft:resistance
     *   minecraft:regeneration
     *   minecraft:speed
     *   irons_spellbooks:haste
     * ============================================================
     */
    function getEffectId(player, effectInstance) {
        try {
            if (effectInstance === null) return null

            var effect = effectInstance.getEffect()
            if (effect === null) return null

            var registryAccess = player.level.registryAccess()
            var effectRegistry = registryAccess.registryOrThrow(Registries.MOB_EFFECT)
            var resourceLocation = effectRegistry.getKey(effect)

            if (resourceLocation === null) return null

            return String(resourceLocation)
        } catch (e) {
            console.error('[酿态之猫] 获取 Buff ID 失败：' + e)
            return null
        }
    }

    /*
     * ============================================================
     * 将 MobEffect ID 转换为效果本地化键格式
     *
     * minecraft:resistance
     *     ↓
     * effect.minecraft.resistance
     *
     * irons_spellbooks:haste
     *     ↓
     * effect.irons_spellbooks.haste
     * ============================================================
     */
    function convertEffectId(effectId) {
        if (effectId === null || effectId.length === 0) return null
        return 'effect.' + effectId.replace(':', '.')
    }

    /*
     * ============================================================
     * 向记录列表中添加一个 Buff ID
     *
     * 返回：
     *   true  = 成功新增
     *   false = 已经存在
     * ============================================================
     */
    function addRecord(list, effectTypeId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('desc') === effectTypeId) return false
            } catch (e) {
                console.error('[酿态之猫] 读取已有 Buff 记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('desc', effectTypeId)
        list.add(tag)
        return true
    }

    /*
     * ============================================================
     * 获取 Buff 本地化名称
     *
     * 例如：
     *
     *   effect.minecraft.resistance
     *       ↓
     *   抗性
     *
     * 如果翻译键不存在，则返回 null。
     * ============================================================
     */
    function getEffectName(effectTypeId) {
        try {
            var component = Component.translatable(effectTypeId)
            var text = String(component.getString())

            if (text === effectTypeId) return null
            if (text.length === 0) return null

            return Component.literal(text)
        } catch (e) {
            console.error('[酿态之猫] 获取 Buff 本地化名称失败：' + e)
            return null
        }
    }

    /*
     * ============================================================
     * 处理单个 Buff
     * ============================================================
     */
    function processEffect(player, effectInstance, effectTypes) {
        var effectId = getEffectId(player, effectInstance)
        if (effectId === null || effectId.length === 0) return false

        var effectTypeId = convertEffectId(effectId)
        if (effectTypeId === null || effectTypeId.length === 0) return false

        /*
         * 已经记录过则不再处理。
         */
        if (!addRecord(effectTypes, effectTypeId)) return false

        /*
         * ========================================================
         * 提示玩家
         * ========================================================
         */
        var effectName = getEffectName(effectTypeId)
        var message = Component.literal('§a[酿态之猫] §7发现新的效果 §8» §f')

        if (effectName !== null) {
            message.append(effectName)
        } else {
            message.append(Component.literal(effectTypeId))
        }

        message.append(Component.literal(' §8[' + effectTypeId + ']'))
        player.tell(message)

        console.info('[酿态之猫] 已记录新 Buff：' + effectTypeId)

        return true
    }

    /*
     * ============================================================
     * 检测单个玩家当前全部 Buff
     * ============================================================
     */
    function processPlayer(player) {
        if (player === null || !player.isPlayer()) return

        try {
            /*
             * 获取玩家 NBT。
             */
            var playerNbt = player.getNbt()
            var forgeCaps = playerNbt.getCompound('ForgeCaps')
            var traveller = forgeCaps.getCompound(TRAVELLER_CAP)

            /*
             * 获取已有记录。
             */
            var effectTypes = traveller.contains(RECORD_LIST) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

            /*
             * 获取玩家当前全部 MobEffect。
             *
             * LivingEntity.getActiveEffects()
             * 返回 Collection<MobEffectInstance>。
             */
            var effects = player.getActiveEffects()
            var iterator = effects.iterator()
            var changed = false

            while (iterator.hasNext()) {
                var effectInstance = iterator.next()

                if (processEffect(player, effectInstance, effectTypes)) {
                    changed = true
                }
            }

            /*
             * 没有新增 Buff 时不重新写 NBT。
             */
            if (!changed) return

            /*
             * ========================================================
             * 保存玩家 NBT
             *
             * effectTypes
             *     ↓
             * traveller
             *     ↓
             * ForgeCaps
             *     ↓
             * playerNbt
             * ========================================================
             */
            traveller.put(RECORD_LIST, effectTypes)
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
        } catch (e) {
            console.error('[酿态之猫] 检测玩家 Buff 失败：' + e)
        }
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
            console.error('[酿态之猫] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    /*
     * ============================================================
     * 服务器 Tick
     *
     * 不使用 PlayerEvents.tick。
     *
     * 每 5 tick 检查一次当前服务器中的所有玩家。
     * ============================================================
     */
    ServerEvents.tick(function (event) {
        try {
            var server = event.server

            /*
             * 每 5 tick 检查一次。
             */
            if (server.getTickCount() % 5 !== 0) return

            var players = server.getPlayerList().getPlayers()

            for (var i = 0; i < players.size(); i++) {
                processPlayer(players.get(i))
            }
        } catch (e) {
            console.error('[酿态之猫] 服务器 Buff 检测失败：' + e)
        }
    })
})()