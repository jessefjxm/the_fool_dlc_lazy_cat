/*
 * ============================================================
 * 陪伴之狐 - 记录玩家看向的有生命值实体
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 每 2 tick 检测一次玩家当前视线。
 *   2. 使用 Minecraft 原生 ProjectileUtil 获取准星目标。
 *   3. 只记录具有有效最大生命值的实体。
 *   4. 将实体 ID 写入：
 *
 *      ForgeCaps."ageofmythology:traveller"
 *        .nbt_spyglass_record
 *
 * 数据格式：
 *
 *      [
 *        {
 *          desc: "entity.minecraft.vindicator"
 *        }
 *      ]
 *
 *   5. 已经记录过的实体不会重复添加。
 *   6. 新发现实体时提示玩家。
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var ProjectileUtil = Java.loadClass('net.minecraft.world.entity.projectile.ProjectileUtil')

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[陪伴之狐] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var RECORD_KEY = 'nbt_spyglass_record'
    var TRAVELLER_KEY = 'ageofmythology:traveller'
    var MAX_DISTANCE = 64.0

    /*
     * ------------------------------------------------------------
     * 获取实体本地化名称
     *
     * 例如：
     *   minecraft:vindicator
     *     -> entity.minecraft.vindicator
     *
     * 如果模组没有提供对应翻译，Minecraft 会显示
     * 未翻译的键，因此最终提示仍然可以保留完整 ID。
     * ------------------------------------------------------------
     */
    function getEntityName(entityId) {
        try {
            var key = 'entity.' + entityId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[陪伴之狐] 获取实体本地化名称失败：' + e)
            return Component.literal(entityId)
        }
    }

    /*
     * ------------------------------------------------------------
     * 添加实体记录
     * ------------------------------------------------------------
     */
    function addRecord(list, entityId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('desc') === entityId) return false
            } catch (e) {
                console.error('[陪伴之狐] 读取已有实体记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('desc', entityId)
        list.add(tag)
        return true
    }

    /*
     * ------------------------------------------------------------
     * 获取玩家当前准星指向的实体
     * ------------------------------------------------------------
     */
    function getLookTarget(player) {
        var hit = ProjectileUtil.getHitResultOnViewVector(player, function (entity) {
            return entity !== player && entity.isPickable()
        }, MAX_DISTANCE)

        if (String(hit.getType()) !== 'ENTITY') return null
        return hit.getEntity()
    }

    /*
     * ------------------------------------------------------------
     * 判断实体是否具有生命值
     *
     * 正常生物、怪物、Boss、模组生物：
     *   getMaxHealth() > 0
     *
     * 箭、掉落物、经验球、特效实体等：
     *   通常没有有效的生命值。
     * ------------------------------------------------------------
     */
    function hasHealth(entity) {
        try {
            return entity.getMaxHealth() > 0
        } catch (e) {
            return false
        }
    }

    /*
     * ------------------------------------------------------------
     * 处理玩家当前准星目标
     * ------------------------------------------------------------
     */
    function process(player) {
        var entity = getLookTarget(player)
        if (entity === null || !hasHealth(entity)) return

        // 获取实体 ID
        var entityId = String(entity.getType())

        /*
         * 读取 Traveller NBT
         */
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound(TRAVELLER_KEY)
        var records = traveller.contains(RECORD_KEY) ? traveller.getList(RECORD_KEY, 10) : new ListTag()

        // 已经记录过则不重复添加
        if (!addRecord(records, entityId)) return

        // 写回 NBT
        traveller.put(RECORD_KEY, records)
        forgeCaps.put(TRAVELLER_KEY, traveller)
        playerNbt.put('ForgeCaps', forgeCaps)
        player.setNbt(playerNbt)

        /*
         * 把新记录同步给客户端，让 UI 立即刷新。
         *
         * 必须放在 setNbt 之后：setNbt 会触发 deserializeNBT，
         * 把 NBT 灌回内存态，此时 sync 才有内容可发。
         */
        syncCapability(player)

        // 提示玩家
        var entityName = getEntityName(entityId)
        var message = Component.literal('§a[陪伴之狐] §7发现新的生物 §8» §f').append(entityName).append(Component.literal(' §8[' + entityId + ']'))
        player.tell(message)
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
            console.error('[陪伴之狐] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    /*
     * ------------------------------------------------------------
     * 每 2 tick 检测一次所有在线玩家
     * ------------------------------------------------------------
     */
    ServerEvents.tick(function (event) {
        if (event.server.tickCount % 2 !== 0) return

        var players = event.server.getPlayerList().getPlayers()

        for (var i = 0; i < players.size(); i++) {
            try {
                process(players.get(i))
            } catch (e) {
                console.error('[陪伴之狐] 检测玩家视线失败：' + e)
            }
        }
    })
})()