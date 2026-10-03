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

    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_damage_type'

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
        var message = Component.literal('§a[坚韧之猫] §7发现新的伤害类型 §8» §f')

        if (damageTypeName !== null) {
            message.append(damageTypeName)
        } else {
            message.append(Component.literal(damageTypeId))
        }

        message.append(Component.literal(' §8[' + damageTypeId + ']'))
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