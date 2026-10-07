/*
 * ============================================================
 * 元素之猫 - 记录火系 / 深渊系 / 岩系生物击杀，写入玩家 NBT
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 一、这三系在哪里定义（不硬编码、不维护常量表）
 *
 *   Age of Mythology 用「实体类型标签(Entity Type Tag)」定义学派，
 *   标签文件位于模组 jar 内：
 *
 *     data/ageofmythology/tags/entity_types/fire.json      -> #ageofmythology:fire
 *     data/ageofmythology/tags/entity_types/abyss.json     -> #ageofmythology:abyss
 *     data/ageofmythology/tags/entity_types/geomancy.json  -> #ageofmythology:geomancy
 *
 *   岩系在源码里对应的常量：
 *     EntityTagGenerator.GEOMANCY        (岩系本体)
 *     EntityTagGenerator.EARTH_SHIELD    = #geomancy
 *     EntityTagGenerator.EARTH_AFFINITY  = #geomancy
 *   即 EARTH_SHIELD / EARTH_AFFINITY 只是 geomancy 的别名标签，
 *   本脚本按「岩系 == #ageofmythology:geomancy」处理。
 *   本整合包实测条目数：火系 35 / 深渊系 31 / 岩系 20。
 *
 *   运行时直接查标签，模组更新增删怪物会自动跟随，
 *   无需在本脚本里维护任何怪物 ID 常量表。
 *   想核对名单就执行 元素之猫_查询.js 提供的 /aomaffinity。
 *
 * 二、写入位置
 *
 *   ForgeCaps."ageofmythology:traveller".nbt_earth_affinity_map
 *
 *   数据格式（结构由模组 CapabilityExtraInfo 决定，
 *   entityType 取自 WonderfulDreamItem.ENTITY_TYPE_TAG）：
 *
 *     nbt_earth_affinity_map: [
 *       {
 *         entityType: "cataclysm:hippocamtus",
 *         value: 5.0
 *       }
 *     ]
 *
 *   value 固定为 5.0，不论哪个系都写入同一张表。
 *
 * 三、触发时机
 *
 *   EntityEvents.death：实体死亡时触发。本整合包实测只有它会触发，
 *   EntityEvents.afterHurt 不触发（故不使用）；
 *   death 触发时实体必然已死亡，因此不需要判断血量。
 *   击杀者由 DamageSource.getActual() 解析（投射物解析为发射者），
 *   失败时依次回退 getImmediate() / source.entity / getKillCredit()。
 *
 * 四、三个必须知道的坑（改动前请先读）
 *
 *   1. 事件里的实体与伤害来源都是 KubeJS 包装对象，方法残缺：
 *        entity.getType() 返回的类型包装器没有 is(TagKey)/getTags()，
 *        也没有可用的 getKey()/builtInRegistryHolder()；
 *        DamageSource 包装器没有 getEntity()（要用 getActual()）。
 *      所以查标签必须走 BuiltInRegistries.ENTITY_TYPE.get(注册表ID)。
 *
 *   2. 包装器的 toString() 是翻译键（entity.minecraft.llama），不是 ID。
 *
 *   3. BuiltInRegistries.ENTITY_TYPE.getKey(包装器) 反查不到，
 *      会返回该注册表的默认值 —— minecraft:pig（实测把羊驼认成猪），
 *      绝不能用它取 ID。
 *
 *   因此取 ID 的策略是：先用包装器文案在注册表里逐条比对
 *   （同时匹配注册表名与翻译键），这也是当前环境下唯一走得通的路。
 *
 * 五、为什么要「NBT + capability」双写（别删掉 sync 那段）
 *
 *   实测结论（一次性探针验证）：
 *     - player.getCapability(...) 在 KubeJS 包装器上可用；
 *     - 模组内存态 affinity_map 与 NBT 完全同源，条数一致
 *       （各 5 条），所以直接写 NBT 不会被内存态覆盖；
 *     - 但模组不会主动去读 NBT：它的 UI（特殊道具说明文本）
 *       与亲和属性只在自身 tick / sync 时机读内存态，
 *       因此纯 NBT 写入要等下一次机制触发才「看得见」。
 *
 *   所以写完 NBT 后再做两件事：
 *     affinity_map.put(entityType, 5.0)  -> 让内存态立即正确
 *     data.sync(player)                  -> 让客户端 UI 立即刷新
 *   两步都用 try 包住：失败也只是 UI 慢一拍，NBT 已落地，功能不受影响。
 *
 *   注意必须用 put(赋值)而不是 addAffinity(累加)：
 *   setNbt 已把内存态从 NBT 重建（该实体已是 5.0），
 *   再累加会变成 10.0（实测踩过这个 bug）。
 *
 * ============================================================
 */

(function () {
    /*
     * 逐个 try 包裹类加载：
     * 任一 loadClass 在加载期抛错都会让 KubeJS 丢弃整份脚本，
     * 现象是 reload 后连日志都没有，所以失败也要继续往下走。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[元素之猫] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var CompoundTag = loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = loadClass('net.minecraft.nbt.ListTag')
    var BuiltInRegistries = loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var ResourceLocation = loadClass('net.minecraft.resources.ResourceLocation')
    var TagKey = loadClass('net.minecraft.tags.TagKey')

    /*
     * 模组自己的 capability 入口与工具类。
     * 实测 player.getCapability(...) 在 KubeJS 包装器上可用，
     * 且内存态 affinity_map 与 NBT 完全同源（条数一致），
     * 所以「按模组 API 写内存态 + 补一次 sync」是安全且能即时刷新 UI 的做法。
     */
    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var FORGE_CAPS = 'ForgeCaps'
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_earth_affinity_map'
    var ENTITY_TYPE_KEY = 'entityType' // 对应 WonderfulDreamItem.ENTITY_TYPE_TAG
    var VALUE_KEY = 'value'
    var FIXED_VALUE = 5.0

    /*
     * 三大系的实体标签：键为日志用的中文名，值为标签 id，
     * 第三个元素是该系在当前整合包里的条目数（进度显示的上限）。
     * 值前面的 # 只是可读性写法，解析时会去掉。
     * 上限可用 元素之猫_查询.js 的 /aomaffinity 复核。
     */
    var AFFINITY_TAGS = [
        ['火系', '#ageofmythology:fire', 35],
        ['深渊系', '#ageofmythology:abyss', 31],
        ['岩系', '#ageofmythology:geomancy', 20]
    ]

    var tagKeyCache = {}
    var tagSetCache = {}

    /*
     * 组装进度标记，两档：当前 / 上限
     *   §8(§a5§7/§f35§8)
     * 当前亮绿=该系已记录的怪物种类数，
     * 上限白色=该系在当前整合包里的怪物总数。
     * 模组对亲和表没有成就阈值（每个怪物各自 5.0 封顶），所以不放中间值。
     */
    function progressText(collected, max) {
        return ' §8(§a' + collected + '§7/§f' + max + '§8)'
    }

    /*
     * ------------------------------------------------------------
     * 标签 id -> TagKey<EntityType<?>>
     * ------------------------------------------------------------
     */
    function resolveTagKey(tagId) {
        if (tagKeyCache[tagId]) return tagKeyCache[tagId]
        var key = null
        try {
            key = TagKey.create(BuiltInRegistries.ENTITY_TYPE.key(), ResourceLocation.parse(tagId.replace('#', '')))
        } catch (e) {
            console.error('[元素之猫] 构建实体标签失败：' + tagId + '，错误：' + e)
            return null
        }
        tagKeyCache[tagId] = key
        return key
    }

    /*
     * ------------------------------------------------------------
     * 实体类型包装器 -> 注册表 ID
     *
     * 按文件头坑 1 / 坑 3：包装器没有可用的 key 方法，
     * 直接用它的文案在注册表里逐条比对；
     * 文案可能是注册表名，也可能是翻译键 entity.<ns>.<path>，两者都匹配。
     * ------------------------------------------------------------
     */
    function toEntityId(entityType) {
        if (entityType === null) return null
        var text = null
        try {
            text = String(entityType)
        } catch (e) {
            console.error('[元素之猫] 读取实体类型文案失败：' + e)
            return null
        }
        if (text === null || text.length === 0) return null
        try {
            var keys = BuiltInRegistries.ENTITY_TYPE.keySet().toArray()
            for (var i = 0; i < keys.length; i++) {
                var key = String(keys[i])
                if (key === text || ('entity.' + key.replace(':', '.')) === text) return key
            }
        } catch (e2) {
            console.error('[元素之猫] 文案反查注册表 ID 失败：' + e2)
        }
        return null
    }

    /*
     * ------------------------------------------------------------
     * 注册表 ID -> 该实体类型自身持有的标签 location 集合
     *
     * 只走 getTags() 比对：这条路径已被 /aomaffinity 实测验证
     * （火 35 / 深渊 31 / 岩 20），而 EntityType.is(TagKey) 在包装器上
     * 时好时坏，不能当主路径。
     * 标签在运行期不变，所以按 ID 缓存，一个怪物只算一次。
     * ------------------------------------------------------------
     */
    function collectTagSet(id) {
        if (tagSetCache[id] !== undefined) return tagSetCache[id]
        var set = {}
        var type = null
        try {
            type = BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse(id))
        } catch (e) {
            console.error('[元素之猫] 解析实体类型失败：' + id + '，错误：' + e)
            type = null
        }
        if (type !== null && type !== undefined) {
            try {
                var tags = type.getTags().toArray()
                for (var i = 0; i < tags.length; i++) {
                    set[String(tags[i].location())] = true
                }
            } catch (e2) {
                console.error('[元素之猫] 读取实体 ' + id + ' 的标签集合失败：' + e2)
            }
        }
        tagSetCache[id] = set
        return set
    }

    /*
     * ------------------------------------------------------------
     * 返回命中的学派名称，未命中返回 null
     * ------------------------------------------------------------
     */
    function resolveAffinity(id) {
        if (id === null || id.length === 0) return null
        var set = collectTagSet(id)
        for (var i = 0; i < AFFINITY_TAGS.length; i++) {
            var tagKey = resolveTagKey(AFFINITY_TAGS[i][1])
            if (tagKey !== null && set[String(tagKey.location())] === true) {
                return { label: AFFINITY_TAGS[i][0], tagId: AFFINITY_TAGS[i][1], max: AFFINITY_TAGS[i][2] }
            }
        }
        return null
    }

    /*
     * ------------------------------------------------------------
     * 统计该系已记录的怪物种类数（进度里的「当前」）
     *
     * nbt_earth_affinity_map 是三系共用的一张表，
     * 所以必须按标签分别统计：逐条取 entityType，
     * 判断它是否属于该系标签。
     * ------------------------------------------------------------
     */
    function collectedInTag(player, tagId) {
        var tagKey = resolveTagKey(tagId)
        if (tagKey === null) return 0
        var count = 0
        try {
            var playerNbt = player.getNbt()
            var forgeCaps = playerNbt.contains('ForgeCaps', 10) ? playerNbt.getCompound('ForgeCaps') : null
            var traveller = forgeCaps !== null && forgeCaps.contains('ageofmythology:traveller', 10) ? forgeCaps.getCompound('ageofmythology:traveller') : null
            var list = traveller !== null && traveller.contains('nbt_earth_affinity_map', 9) ? traveller.getList('nbt_earth_affinity_map', 10) : null
            if (list === null) return 0
            var target = String(tagKey.location())
            for (var i = 0; i < list.size(); i++) {
                try {
                    var id = list.getCompound(i).getString('entityType')
                    if (id === null || id.length === 0) continue
                    if (collectTagSet(id)[target] === true) count++
                } catch (e) { /* 跳过坏记录 */ }
            }
        } catch (e2) {
            console.error('[元素之猫] 统计该系已记录条数失败：' + e2)
        }
        return count
    }

    /*
     * ------------------------------------------------------------
     * 判断是否为玩家
     * ------------------------------------------------------------
     */
    function isPlayer(entity) {
        try {
            return entity.isPlayer()
        } catch (e) {
            console.error('[元素之猫] 判断玩家实体失败：' + e)
            return false
        }
    }

    /*
     * ------------------------------------------------------------
     * 从伤害来源解析玩家击杀者
     *
     * DamageSource 是包装对象：getActual() 取真正攻击者
     * （投射物解析为发射者），失败再依次回退；
     * 最后退回击杀归属，覆盖免疫 / 环境伤害等情况。
     * ------------------------------------------------------------
     */
    function resolveKiller(source, victim) {
        if (source !== null && source !== undefined) {
            try {
                var attacker = source.getActual()
                if (attacker !== null && isPlayer(attacker)) return attacker
            } catch (e1) {
                console.error('[元素之猫] 解析伤害来源攻击者失败：' + e1)
            }
            try {
                var direct = source.getImmediate()
                if (direct !== null && isPlayer(direct)) return direct
            } catch (e2) {
                console.error('[元素之猫] 解析直接伤害来源失败：' + e2)
            }
            try {
                var srcEntity = source.entity
                if (srcEntity !== null && isPlayer(srcEntity)) return srcEntity
            } catch (e3) {
                console.error('[元素之猫] 解析伤害来源实体失败：' + e3)
            }
        }
        try {
            var credit = victim === null ? null : victim.getKillCredit()
            if (credit !== null && isPlayer(credit)) return credit
        } catch (e4) {
            console.error('[元素之猫] 解析击杀归属失败：' + e4)
        }
        return null
    }

    /*
     * ------------------------------------------------------------
     * 实体 ID -> 本地化名称组件
     * 例如 cataclysm:hippocamtus -> entity.cataclysm.hippocamtus
     * ------------------------------------------------------------
     */
    function getEntityName(entityId) {
        try {
            return Component.translatable('entity.' + entityId.replace(':', '.'))
        } catch (e) {
            console.error('[元素之猫] 获取实体本地化名称失败：' + e)
            return Component.literal(entityId)
        }
    }

    /*
     * ------------------------------------------------------------
     * 把 entityId 写入玩家 NBT，已存在同一 entityType 时不重复添加
     *
     * 显式逐层写回 traveller -> ForgeCaps -> playerNbt，
     * 避免 ForgeCaps 或 traveller 原本不存在时，
     * 新创建的 CompoundTag 没有真正挂回玩家 NBT。
     * ------------------------------------------------------------
     */
    function recordAffinity(player, entityId) {
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.contains(FORGE_CAPS, 10) ? playerNbt.getCompound(FORGE_CAPS) : new CompoundTag()
        var traveller = forgeCaps.contains(TRAVELLER_CAP, 10) ? forgeCaps.getCompound(TRAVELLER_CAP) : new CompoundTag()
        var list = traveller.contains(RECORD_LIST, 9) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

        for (var i = 0; i < list.size(); i++) {
            try {
                if (list.getCompound(i).getString(ENTITY_TYPE_KEY) === entityId) return false
            } catch (e) {
                console.error('[元素之猫] 读取已有亲和记录失败 #' + i + '：' + e)
            }
        }

        var record = new CompoundTag()
        record.putString(ENTITY_TYPE_KEY, entityId)
        record.putDouble(VALUE_KEY, FIXED_VALUE)
        list.add(record)

        traveller.put(RECORD_LIST, list)
        forgeCaps.put(TRAVELLER_CAP, traveller)
        playerNbt.put(FORGE_CAPS, forgeCaps)
        player.setNbt(playerNbt)

        /*
         * 再按模组自己的写入路径更新内存态并通知客户端。
         *
         * 为什么需要这一步：
         *   模组的 UI（特殊道具说明文本）与亲和属性只在它自己的
         *   tick / sync 时机读内存态，纯 NBT 写入要等下一次机制
         *   触发才会被「看见」，表现就是 UI 不即时刷新。
         *
         * 关键：这里必须用 put(赋值)而不是 addAffinity(累加)。
         *   上面的 setNbt 已经把内存态从 NBT 重建过，
         *   此时该实体在内存里就是 5.0；再调 addAffinity 会变成
         *   10.0（实测 bug）。put 是幂等的，与「value 固定 5.0」一致。
         */
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data === null) return true
            data.getExtraInfo().affinity_map.put(BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse(entityId)), FIXED_VALUE)
            /*
             * sync 会重发 capability 数据包，让客户端 UI 立即刷新。
             */
            data.sync(player)
        } catch (e) {
            console.error('[元素之猫] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
        return true
    }

    /*
     * ------------------------------------------------------------
     * 处理一次死亡
     * ------------------------------------------------------------
     */
    function handleDeath(entity, source) {
        if (entity === null) return

        var wrapper = null
        try {
            wrapper = entity.getType()
        } catch (e) {
            console.error('[元素之猫] 读取实体类型失败：' + e)
            return
        }
        if (wrapper === null) return

        var entityId = toEntityId(wrapper)
        if (entityId === null) {
            console.error('[元素之猫] 无法取得实体注册表 ID，类型=' + String(wrapper))
            return
        }

        var affinity = resolveAffinity(entityId)
        if (affinity === null) return

        var player = resolveKiller(source, entity)
        if (player === null) return

        if (!recordAffinity(player, entityId)) return

        /*
         * 进度显示：当前=该系已记录怪物种类数，上限=该系在当前整合包里的怪物总数。
         */
        var collected = collectedInTag(player, affinity.tagId)
        var message = Component.literal('§a[元素之猫] §7记录' + affinity.label + '生物 §8» §f').append(getEntityName(entityId)).append(Component.literal(' §8[' + entityId + ']')).append(Component.literal(progressText(collected, affinity.max)))
        player.tell(message)
        console.log('[元素之猫] 玩家 ' + String(player.username) + ' 击杀' + affinity.label + '生物：' + entityId + '（进度 ' + collected + '/' + affinity.max + '）')
    }

    /*
     * ------------------------------------------------------------
     * 实体死亡：只用 death
     * （本整合包实测 afterHurt 不触发，death 会触发）
     * ------------------------------------------------------------
     */
    EntityEvents.death(function (event) {
        try {
            var entity = event.getEntity()
            if (entity === null) return
            handleDeath(entity, event.getSource())
        } catch (e) {
            console.error('[元素之猫] 处理死亡事件失败：' + e)
        }
    })
})()
