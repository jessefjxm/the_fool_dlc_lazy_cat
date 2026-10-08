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
     * 获取伤害类型的两个 ID
     *
     * 【关键】模组记录的不是注册表 ID，而是 msgId：
     *
     *   CatOfTenacityItem#handleLivingHurtEvent:
     *       String damageId = damageSource.m_19385_();   // getMsgId()
     *       data.getExtraInfo().damage_type.add(damageId);
     *
     *   m_19385_ = DamageSource.getMsgId()，
     *   它返回"死亡消息键去掉 death.attack. 之后那段"，例如：
     *
     *     注册表 minecraft:indirect_magic -> msgId indirectMagic
     *     注册表 goety:shock              -> msgId goety.shock
     *     注册表 minecraft:generic        -> msgId generic
     *
     *   注意两点：
     *     1. 原版 msgId 是驼峰无下划线（indirectMagic），
     *        与注册表路径（indirect_magic）不同；
     *     2. 模组（如 goety）的 msgId 用点连接（goety.shock），
     *        与注册表 id 的冒号形式也不同。
     *
     * 所以这里同时返回两个：
     *   msgId      —— 写进 nbt_damage_type，保证与模组自身记录一致
     *   registryId —— 仅用于悬停里显示，便于查证
     * ============================================================
     */
    function getDamageTypeIds(player, damageSource) {
        try {
            var damageType = damageSource.type()
            if (damageType === null || damageType === undefined) return null

            var registryAccess = player.level.registryAccess()
            var damageTypeRegistry = registryAccess.registryOrThrow(Registries.DAMAGE_TYPE)
            var resourceLocation = damageTypeRegistry.getKey(damageType)

            var registryId = resourceLocation === null ? null : String(resourceLocation)

            /*
             * msgId：从 DamageType.toString() 里抠。
             *
             * 实测这个环境（1.20.1 Forge + KubeJS）里
             * DamageType.getMsgId() 是不存在的：
             *   TypeError: Cannot find function getMsgId in object
             *   DamageType[msgId=..., scaling=..., ...]
             * 但 toString() 里带着 msgId，格式固定：
             *   DamageType[msgId=<值>, scaling=...
             * 所以用正则取出来，这是唯一可靠的路径。
             */
            var msgId = null
            try {
                var text = String(damageType)
                var match = /msgId=([^,\]]+)/.exec(text)
                if (match !== null && match[1] !== undefined) msgId = String(match[1]).trim()
            } catch (e0) {
                msgId = null
            }

            /* 退路：DamageSource.getMsgId()（模组自己用的就是它） */
            if (msgId === null || msgId.length === 0) {
                try {
                    msgId = String(damageSource.getMsgId())
                } catch (e1) {
                    msgId = null
                }
            }
            if (msgId === null || msgId.length === 0) return null

            return { msgId: msgId, registryId: registryId }
        } catch (e) {
            console.error('[坚韧之猫] 获取伤害类型 ID 失败：' + e)
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
         * 获取本次伤害的两个 ID：msgId（记录用）与注册表 id（显示用）。
         */
        var ids = getDamageTypeIds(player, damageSource)
        if (ids === null) return
        var damageTypeId = ids.msgId          // 与模组同口径，写进 nbt_damage_type
        var registryId = ids.registryId       // 仅用于悬停展示
        if (damageTypeId === null || damageTypeId.length === 0) return

        /*
         * 归一化到 msgId 口径。
         *
         * 映射表是缓存的（见 canonicalMaps）：遍历 293 条注册表不便宜，
         * 绝不能每受一次伤就重建一次 —— 那样日志会被刷屏。
         * 缓存由登录迁移时预热；这里即使缓存还没建，
         * canonicalMaps 也只会建一次。
         */
        try {
            damageTypeId = canonicalMsgId(damageTypeId, canonicalMaps(player))
        } catch (eNorm) {
            console.error('[坚韧之猫] 归一化伤害类型 ID 失败：' + eNorm)
        }

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

        var lines = ['§7伤害类型 msgId: §f' + damageTypeId]
        if (registryId !== null && String(registryId) !== String(damageTypeId)) {
            lines.push('§7注册表 ID: §f' + registryId)
        }
        /* 死亡消息键 = death.attack. + msgId，与模组判定同源 */
        lines.push('§7死亡消息键: §fdeath.attack.' + damageTypeId)
        lines.push('§7当前已记录: §f' + damageTypes.size() + ' §7/ 上限 §f' + MAX_COUNT)
        lines.push('§7成就阈值: §e' + GOAL_COUNT + '§8（佩戴超过 ' + GOAL_COUNT + ' 种伤害类型时加成翻倍）')
        lines.push('§8悬停来源：DamageSource.getMsgId（与模组记录同口径）')

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
    function getDamageTypeName(msgId) {
        try {
            /*
             * msgId 本身已经是"死亡消息键去掉 death.attack. 之后那段"
             * （例如 generic / indirectMagic / goety.shock），
             * 所以直接用点号形式拼回去即可，不要再做冒号替换。
             */
            var key = 'death.attack.' + msgId
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
     * 老记录迁移（进入存档时自动执行）
     *
     * 背景：
     *   本脚本早期版本往 nbt_damage_type 里写的是**注册表 ID**
     *   （minecraft:indirect_magic、goety:shock），
     *   而模组自己写的是 **msgId**（indirectMagic、goety.shock）。
     *   两种口径混在一张表里，会导致：
     *     - 同一个伤害类型被记成两条（少算进度、多加属性）
     *     - 模组/本脚本各自查重时互相看不见
     *
     * 做法：
     *   1. 用注册表建两张映射
     *        msgId      -> 自身
     *        registryId -> msgId
     *   2. 逐条把老值翻成 msgId；
     *      已经是 msgId 的（含模组写的 goety.shock）原样保留；
     *      两者都匹配不上（例如模组已删除该条目）就保留原值，不丢数据
     *   3. 去重 —— 这一步就是"合并新老记录"
     *   4. 条数变了才写回，并同步客户端
     *
     * 幂等：跑过之后表里全是 msgId，再跑不会产生任何变化。
     * ============================================================
     */
    /*
     * 建双向映射表：
     *
     *   regToMsg : "minecraft:indirect_magic" -> "indirectMagic"   （老格式纠错）
     *   msgToReg : "indirectMagic"            -> "minecraft:indirect_magic"
     *   bareToMsg: "indirectMagic"            -> "indirectMagic"
     *              "nuke"                     -> "nuke"            （裸 id 保持裸 id）
     *
     * msgId 的来源：DamageType.toString()。
     *   实测这个环境里 DamageType.getMsgId() 不存在，
     *   但 toString() 固定是
     *     DamageType[msgId=<值>, scaling=..., exhaustion=..., ...]
     *   所以用正则从里面取，这是唯一可靠的路径。
     */
    function parseMsgId(damageType) {
        try {
            var text = String(damageType)
            var match = /msgId=([^,\]]+)/.exec(text)
            if (match !== null && match[1] !== undefined) return String(match[1]).trim()
        } catch (e) {
            /* 落到返回 null */
        }
        return null
    }

    function buildCanonicalMaps(player) {
        var regToMsg = {}
        var msgToReg = {}
        var bareToMsg = {}
        var total = 0
        var failed = 0

        try {
            var registry = player.level.registryAccess().registryOrThrow(Registries.DAMAGE_TYPE)
            var keys = registry.keySet().toArray()

            for (var i = 0; i < keys.length; i++) {
                var regId = String(keys[i])
                try {
                    var type = registry.get(keys[i])
                    if (type === null || type === undefined) continue

                    var msgId = parseMsgId(type)
                    if (msgId === null || msgId.length === 0) {
                        failed++
                        if (failed <= 3) console.error('[坚韧之猫] 解析 msgId 失败：' + regId + ' toString=' + String(type))
                        continue
                    }

                    regToMsg[regId] = msgId
                    if (msgToReg[msgId] === undefined) msgToReg[msgId] = regId
                    if (bareToMsg[msgId] === undefined) bareToMsg[msgId] = msgId
                    total++
                } catch (e1) {
                    failed++
                    if (failed <= 3) console.error('[坚韧之猫] 建表失败 ' + regId + '：' + e1)
                }
            }
        } catch (e) {
            console.error('[坚韧之猫] 遍历伤害类型注册表失败：' + e)
        }

        console.info('[坚韧之猫] 建表结果：成功 ' + total + ' 条，失败 ' + failed +
            ' 条，样例 indirect_magic -> ' + String(regToMsg['minecraft:indirect_magic']))

        return { regToMsg: regToMsg, msgToReg: msgToReg, bareToMsg: bareToMsg, total: total, failed: failed }
    }

    /*
     * 映射表缓存
     *
     * 建一次要遍历 293 条注册表，所以进程内只建一次：
     *   - 登录迁移时预热（那是唯一"该出现建表日志"的时机）
     *   - 记录新伤害类型时若还没建过，就地建一次并缓存
     * 之后无论受多少次伤都不会再建表、也不会再打日志。
     */
    var cachedMaps = null

    function canonicalMaps(player) {
        if (cachedMaps !== null) return cachedMaps
        cachedMaps = buildCanonicalMaps(player)
        return cachedMaps
    }

    /*
     * 换存档 / 服务器重载时清缓存：
     * 不同存档可能装了不同的伤害类型（数据包差异），
     * 重建一次比用旧表更安全。
     */
    ServerEvents.loaded(function (event) {
        cachedMaps = null
    })

    /*
     * 把任意历史写法归一化成 msgId
     *
     * 处理三类输入：
     *   1. 已经是 msgId（goety.shock / indirectMagic / nuke）-> 原样返回
     *   2. 注册表 id（minecraft:indirect_magic / goety:shock）-> 翻成 msgId
     *   3. 与注册表 id 同名的裸 id（magic / nuke）-> 保持原样（本身就是 msgId）
     *
     * 无法识别时返回原值，绝不丢数据。
     */
    function canonicalMsgId(raw, maps) {
        if (raw === null || raw === undefined) return null
        var value = String(raw)
        if (value.length === 0) return value

        /* 2. 注册表 id -> msgId（最关键的旧格式纠正） */
        if (maps.regToMsg[value] !== undefined) return maps.regToMsg[value]
        /* 1. 已经是 msgId */
        if (maps.msgToReg[value] !== undefined) return value
        /* 3. 裸 id：本身就是 msgId */
        if (maps.bareToMsg[value] !== undefined) return value

        return value
    }

    function migrateRecords(player) {
        try {
            console.info('[坚韧之猫] 迁移：开始检查')
            var playerNbt = player.getNbt()
            var forgeCaps = playerNbt.getCompound('ForgeCaps')
            var traveller = forgeCaps.getCompound(TRAVELLER_CAP)
            if (!traveller.contains(RECORD_LIST)) {
                console.info('[坚韧之猫] 迁移：没有 ' + RECORD_LIST + '，跳过')
                return null
            }

            var old = traveller.getList(RECORD_LIST, 10)
            if (old === null || old.size() === 0) {
                console.info('[坚韧之猫] 迁移：记录表为空，跳过')
                return null
            }
            console.info('[坚韧之猫] 迁移：读到 ' + old.size() + ' 条记录')

            var map = canonicalMaps(player)
            console.info('[坚韧之猫] 迁移：映射表 regToMsg=' + Object.keys(map.regToMsg).length + ' 条')

            var kept = []
            var seen = {}
            var legacyFixed = 0
            var merged = 0

            for (var i = 0; i < old.size(); i++) {
                var raw = null
                try {
                    raw = String(old.getCompound(i).getString('desc'))
                } catch (e1) {
                    console.error('[坚韧之猫] 迁移：读取第 ' + i + ' 条失败：' + e1)
                    continue
                }
                if (raw === null || raw.length === 0) continue

                var canonical = canonicalMsgId(raw, map)
                if (canonical !== raw) {
                    legacyFixed++
                    console.info('[坚韧之猫] 迁移：' + raw + ' -> ' + canonical)
                }

                if (seen[canonical] === true) {
                    /* 与已有条目等价（这就是新老记录重合的情况），合并掉 */
                    merged++
                    continue
                }
                seen[canonical] = true
                kept.push(canonical)
            }

            console.info('[坚韧之猫] 迁移：修正 ' + legacyFixed + '，合并 ' + merged + '，' + old.size() + ' -> ' + kept.length)
            if (legacyFixed === 0 && merged === 0) {
                console.info('[坚韧之猫] 迁移：无需改动')
                return null
            }

            var rebuilt = new ListTag()
            for (var k = 0; k < kept.length; k++) {
                var tag = new CompoundTag()
                tag.putString('desc', kept[k])
                rebuilt.add(tag)
            }

            traveller.put(RECORD_LIST, rebuilt)
            forgeCaps.put(TRAVELLER_CAP, traveller)
            playerNbt.put('ForgeCaps', forgeCaps)
            player.setNbt(playerNbt)

            /*
             * setNbt 之后才能同步（sync 发的是 deserialize 出来的内存态）
             */
            try {
                var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
                if (data !== null) data.sync(player)
            } catch (eSync) {
                console.error('[坚韧之猫] 迁移后同步 capability 失败：' + eSync)
            }

            console.info('[坚韧之猫] 伤害类型记录迁移完成：旧格式纠正 ' + legacyFixed +
                ' 条，合并重复 ' + merged + ' 条，' + old.size() + ' -> ' + kept.length)
            return { before: old.size(), after: kept.length, legacyFixed: legacyFixed, merged: merged }
        } catch (e) {
            console.error('[坚韧之猫] 迁移伤害类型记录失败（不影响新记录）：' + e)
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

    /*
     * ============================================================
     * 进入存档时迁移老记录
     *
     * 用 loggedIn（不是 tick）：迁移只需要在玩家进服时做一次，
     * 之后表里已经全是 msgId，migrateRecords 会直接返回、不做任何写入。
     * ============================================================
     */
    PlayerEvents.loggedIn(function (event) {
        try {
            var player = event.getPlayer()
            if (player === null) {
                console.info('[坚韧之猫] 登录事件里拿不到玩家')
                return
            }
            console.info('[坚韧之猫] 登录事件触发，准备迁移：' + String(player.username))
            /*
             * 延后 2 秒再迁移。
             *
             * loggedIn 触发时玩家的 capability 可能还没从存档
             * 反序列化完成，此时 getNbt() 读到的 traveller 里
             * 没有 nbt_damage_type，迁移就会「看起来什么都没发生」。
             * 延迟一下让 capability 先就位。
             */
            var server = player.getServer()
            if (server === null) {
                console.info('[坚韧之猫] 拿不到 server，立即迁移')
                runMigration(player)
                return
            }
            server.schedule(40, function () {   // 40 tick ≈ 2 秒
                runMigration(player)
            })
        } catch (e) {
            console.error('[坚韧之猫] 登录迁移失败：' + e)
        }
    })

    function runMigration(player) {
        try {
            var result = migrateRecords(player)
            if (result !== null) {
                player.tell(Component.literal('§a[坚韧之猫] §7已整理伤害类型记录：§f' +
                    result.before + ' §7-> §f' + result.after +
                    ' §8（修正旧格式 ' + result.legacyFixed + ' 条，合并重复 ' + result.merged + ' 条）'))
            } else {
                console.info('[坚韧之猫] 迁移：无需改动')
            }
        } catch (e) {
            console.error('[坚韧之猫] 执行迁移失败：' + e)
        }
    }
})()