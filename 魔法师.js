/*
 * ============================================================
 * 魔法师 - 记录 魔法系 / 巫法系 生物击杀，写入玩家 NBT
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 一、这两系在哪里定义（不硬编码、不维护常量表）
 *
 *   Age of Mythology 用「实体类型标签(Entity Type Tag)」定义学派，
 *   标签文件位于模组 jar 内：
 *
 *     data/ageofmythology/tags/entity_types/magic.json  -> #ageofmythology:magic
 *     data/ageofmythology/tags/entity_types/goety.json  -> #ageofmythology:goety
 *
 *   源码里对应的常量：
 *     EntityTagGenerator.MAGIC = AOMTags.MAGIC   （魔法系）
 *     EntityTagGenerator.GOETY = create("goety") （巫法系）
 *
 *   注意 goety.json 里 goety:haunted_armor 与 goety:haunted_armor_servant
 *   各写了两遍，去重后为 59 条（魔法系 37 条）。
 *
 *   因此运行时直接查标签即可，模组更新增删怪物会自动跟随，
 *   无需在本脚本里维护任何怪物 ID 常量表。
 *   想核对名单就执行 魔法师_查询.js 提供的 /aommagicschool。
 *
 * 二、写入位置
 *
 *   ForgeCaps."ageofmythology:traveller".nbt_magic_skills
 *
 *   数据格式与模组的 CapabilityExtraInfo.magic_skills 一致
 *   （entityType 取自 WonderfulDreamItem.ENTITY_TYPE_TAG）：
 *
 *     nbt_magic_skills: [
 *       {
 *         entityType: "irons_spellbooks:archevoker",
 *         value: 1.0
 *       },
 *       {
 *         entityType: "irons_spellbooks:priest",
 *         value: 1.0
 *       }
 *     ]
 *
 *   value 规则：不足 5 的补到 5，已经 >= 5 的保持原值不降级。
 *   模组自身对这个字段也是 5.0 封顶（GrandMageItem 里
 *   getMagicSkills(...) < 5.0 才 +1），所以「补到 5」与模组语义一致。
 *
 * 三、触发时机
 *
 *   EntityEvents.death：实体死亡时触发，且必须满足：
 *     1. 被杀生物的类型命中 #ageofmythology:magic 或 #ageofmythology:goety；
 *     2. 击杀者是玩家（DamageSource.getActual() 解析，投射物算发射者）。
 *   打怪但没打死不会记录（death 只在真正死亡时触发）。
 *
 * 四、三个必须知道的坑（与元素之猫一致，改动前请先读）
 *
 *   1. 事件里的实体与伤害来源都是 KubeJS 包装对象，方法残缺：
 *        entity.getType() 返回的类型包装器没有 is(TagKey)/getTags()，
 *        也没有可用的 getKey()/builtInRegistryHolder()；
 *        DamageSource 包装器没有 getEntity()（要用 getActual()）。
 *
 *   2. 包装器的 toString() 是翻译键（entity.minecraft.llama），不是 ID。
 *
 *   3. BuiltInRegistries.ENTITY_TYPE.getKey(包装器) 反查不到，
 *      会返回该注册表的默认值 minecraft:pig，绝不能用它取 ID。
 *      取 ID 只能拿包装器文案去注册表逐条比对（见 toEntityId）。
 *
 *   因此查标签必须先用注册表 ID 换回 Java EntityType，
 *   再比对它自身持有的标签集合（getTags）。
 *
 * 五、客户端 UI 同步
 *
 *   模组的 UI / 属性只读内存态，且只在自身 tick 与 sync 时机刷新；
 *   纯 NBT 写入后客户端数据包仍是旧的，表现就是文本不即时刷新。
 *   所以写完 NBT 后再补两件事：
 *     magic_skills.put(entityType, 5.0)  -> 让内存态立即正确
 *     data.sync(player)                  -> 让客户端 UI 立即刷新
 *   都在 try 里：失败也只是 UI 慢一拍，NBT 已落地。
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
            console.error('[魔法师] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var CompoundTag = loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = loadClass('net.minecraft.nbt.ListTag')
    var BuiltInRegistries = loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var ResourceLocation = loadClass('net.minecraft.resources.ResourceLocation')
    var TagKey = loadClass('net.minecraft.tags.TagKey')
    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var FORGE_CAPS = 'ForgeCaps'
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_magic_skills'
    var ENTITY_TYPE_KEY = 'entityType' // 对应 WonderfulDreamItem.ENTITY_TYPE_TAG
    var VALUE_KEY = 'value'
    var MIN_VALUE = 5.0

    /*
     * 两大系的实体标签：键为日志/提示用的名称，值为标签 id。
     * 值前面的 # 只是可读性写法，解析时会去掉。
     * 顺序即优先级：同时命中多个标签时只按第一个记录。
     */
    var AFFINITY_TAGS = [
        ['魔法系', '#ageofmythology:magic'],
        ['巫法系', '#ageofmythology:goety']
    ]

    var tagKeyCache = {}
    var tagSetCache = {}

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
            console.error('[魔法师] 构建实体标签失败：' + tagId + '，错误：' + e)
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
            console.error('[魔法师] 读取实体类型文案失败：' + e)
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
            console.error('[魔法师] 文案反查注册表 ID 失败：' + e2)
        }
        return null
    }

    /*
     * ------------------------------------------------------------
     * 注册表 ID -> 该实体类型自身持有的标签 location 集合
     *
     * 只走 getTags() 比对：这条路径已被元素之猫 / aomaffinity 实测验证，
     * 而 EntityType.is(TagKey) 在包装器上时好时坏，不能当主路径。
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
            console.error('[魔法师] 解析实体类型失败：' + id + '，错误：' + e)
            type = null
        }
        if (type !== null && type !== undefined) {
            try {
                var tags = type.getTags().toArray()
                for (var i = 0; i < tags.length; i++) {
                    set[String(tags[i].location())] = true
                }
            } catch (e2) {
                console.error('[魔法师] 读取实体 ' + id + ' 的标签集合失败：' + e2)
            }
        }
        tagSetCache[id] = set
        return set
    }

    /*
     * ------------------------------------------------------------
     * 返回命中的学派信息 { label, tagId }，未命中返回 null
     *
     * tagId 一并返回，供收集进度统计按系分别计数
     * （两个系共用同一张 nbt_magic_skills 表，必须知道是哪一系）。
     * ------------------------------------------------------------
     */
    function resolveAffinity(id) {
        if (id === null || id.length === 0) return null
        var set = collectTagSet(id)
        for (var i = 0; i < AFFINITY_TAGS.length; i++) {
            var tagKey = resolveTagKey(AFFINITY_TAGS[i][1])
            if (tagKey !== null && set[String(tagKey.location())] === true) {
                return { label: AFFINITY_TAGS[i][0], tagId: AFFINITY_TAGS[i][1] }
            }
        }
        return null
    }

    /*
     * ============================================================
     * 收集进度统计
     *
     * 分母：该标签在当前整合包里一共有多少种生物，运行时用标签
     *       数出来（遍历注册表 + getTags 比对），而不是写死 37/59
     *       —— 模组增删条目时进度会自动跟随。
     *       只在第一次用到某个标签时算一遍，结果缓存。
     * 分子：玩家 nbt_magic_skills 里已经有记录的、且属于该标签的条数。
     *       （nbt_magic_skills 是魔法系与巫法系共用的一张表，
     *         所以必须按标签分别统计，不能直接取列表长度。）
     * ============================================================
     */
    var tagEntityTotals = {}

    function tagTotal(tagId) {
        if (tagEntityTotals[tagId] !== undefined) return tagEntityTotals[tagId]
        var total = 0
        try {
            var tagKey = resolveTagKey(tagId)
            if (tagKey !== null) {
                var keys = BuiltInRegistries.ENTITY_TYPE.keySet().toArray()
                for (var i = 0; i < keys.length; i++) {
                    try {
                        var type = BuiltInRegistries.ENTITY_TYPE.get(keys[i])
                        if (type === null) continue
                        var tags = type.getTags().toArray()
                        for (var k = 0; k < tags.length; k++) {
                            if (String(tags[k].location()) === String(tagKey.location())) {
                                total++
                                break
                            }
                        }
                    } catch (e) {
                        /* 单个实体查询失败就跳过，不影响总数 */
                    }
                }
            }
        } catch (e2) {
            console.error('[魔法师] 统计标签条目数失败：' + tagId + '，错误：' + e2)
        }
        tagEntityTotals[tagId] = total
        return total
    }

    /*
     * 统计玩家记录列表里、属于该标签的条数（分子）
     */
    function collectedInTag(list, tagId) {
        var tagKey = resolveTagKey(tagId)
        if (tagKey === null) return 0
        var count = 0
        for (var i = 0; i < list.size(); i++) {
            try {
                var id = list.getCompound(i).getString(ENTITY_TYPE_KEY)
                if (id === null || id.length === 0) continue
                var set = collectTagSet(id)
                if (set[String(tagKey.location())] === true) count++
            } catch (e) {
                console.error('[魔法师] 统计已收集条目失败 #' + i + '：' + e)
            }
        }
        return count
    }

    /*
     * 组装进度标记，两档：当前 / 上限
     *   §8(§a5§7/§f37§8)
     * 当前亮绿=已记录怪物种类数，
     * 上限白色=该系在当前整合包里的怪物总数（标签条目数）。
     * 模组对这个字段没有成就阈值（每种生物各自 5.0 封顶），所以不放中间值。
     */
    function progressText(collected, max) {
        return ' §8(§a' + collected + '§7/§f' + max + '§8)'
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
            console.error('[魔法师] 判断玩家实体失败：' + e)
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
                console.error('[魔法师] 解析伤害来源攻击者失败：' + e1)
            }
            try {
                var direct = source.getImmediate()
                if (direct !== null && isPlayer(direct)) return direct
            } catch (e2) {
                console.error('[魔法师] 解析直接伤害来源失败：' + e2)
            }
            try {
                var srcEntity = source.entity
                if (srcEntity !== null && isPlayer(srcEntity)) return srcEntity
            } catch (e3) {
                console.error('[魔法师] 解析伤害来源实体失败：' + e3)
            }
        }
        try {
            var credit = victim === null ? null : victim.getKillCredit()
            if (credit !== null && isPlayer(credit)) return credit
        } catch (e4) {
            console.error('[魔法师] 解析击杀归属失败：' + e4)
        }
        return null
    }

    /*
     * ------------------------------------------------------------
     * 实体 ID -> 本地化名称组件
     * 例如 irons_spellbooks:archevoker -> entity.irons_spellbooks.archevoker
     * ------------------------------------------------------------
     */
    function getEntityName(entityId) {
        try {
            return Component.translatable('entity.' + entityId.replace(':', '.'))
        } catch (e) {
            console.error('[魔法师] 获取实体本地化名称失败：' + e)
            return Component.literal(entityId)
        }
    }

    /*
     * ------------------------------------------------------------
     * 在记录列表里查找 entityType 对应的下标，找不到返回 -1
     * ------------------------------------------------------------
     */
    function indexOfRecord(list, entityId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                if (list.getCompound(i).getString(ENTITY_TYPE_KEY) === entityId) return i
            } catch (e) {
                console.error('[魔法师] 读取已有魔法记录失败 #' + i + '：' + e)
            }
        }
        return -1
    }

    /*
     * ------------------------------------------------------------
     * 把 entityId 写入玩家 NBT
     *
     * value 规则：不足 5 补到 5，已经 >= 5 保持原值（不降级）。
     * 列表里没有该 entityType 就追加一条；有则按上面的规则更新。
     *
     * 返回 { changed: 是否真的写入, collected: 该系已收集, total: 该系总数 }，
     * 后两项用于给玩家显示收集进度。
     *
     * 显式逐层写回 traveller -> ForgeCaps -> playerNbt，
     * 避免 ForgeCaps 或 traveller 原本不存在时，
     * 新创建的 CompoundTag 没有真正挂回玩家 NBT。
     * ------------------------------------------------------------
     */
    function recordAffinity(player, entityId, tagId) {
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.contains(FORGE_CAPS, 10) ? playerNbt.getCompound(FORGE_CAPS) : new CompoundTag()
        var traveller = forgeCaps.contains(TRAVELLER_CAP, 10) ? forgeCaps.getCompound(TRAVELLER_CAP) : new CompoundTag()
        var list = traveller.contains(RECORD_LIST, 9) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

        var index = indexOfRecord(list, entityId)
        var current = 0.0
        if (index >= 0) {
            try {
                current = list.getCompound(index).getDouble(VALUE_KEY)
            } catch (e) {
                console.error('[魔法师] 读取已有 value 失败：' + e)
            }
        }
        var next = Math.max(current, MIN_VALUE)
        if (index >= 0 && next <= current) {
            /*
             * 已经 >= 5，不写、不降级、也不重复提示。
             */
            return { changed: false, collected: collectedInTag(list, tagId), total: tagTotal(tagId) }
        }

        var record = new CompoundTag()
        record.putString(ENTITY_TYPE_KEY, entityId)
        record.putDouble(VALUE_KEY, next)
        if (index >= 0) {
            list.set(index, record)
        } else {
            list.add(record)
        }

        traveller.put(RECORD_LIST, list)
        forgeCaps.put(TRAVELLER_CAP, traveller)
        playerNbt.put(FORGE_CAPS, forgeCaps)
        player.setNbt(playerNbt)

        /*
         * 再按模组自己的写入路径更新内存态并通知客户端。
         *
         * 为什么需要这一步：
         *   模组的 UI / 属性只在它自己的 tick / sync 时机读内存态，
         *   纯 NBT 写入要等下一次机制触发才会被「看见」，UI 不即时刷新。
         *
         * 关键：这里必须用 put(赋值)而不是 addMagicSkills(累加)。
         *   上面的 setNbt 已经把内存态从 NBT 重建过，此时该实体
         *   在内存里已经是 next；再调 addMagicSkills 会变成
         *   2 × next（元素之猫踩过同类 bug）。put 是幂等的。
         */
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data === null) {
                return { changed: true, collected: collectedInTag(list, tagId), total: tagTotal(tagId) }
            }
            data.getExtraInfo().magic_skills.put(BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse(entityId)), next)
            /*
             * sync 会重发 capability 数据包，让客户端 UI 立即刷新。
             */
            data.sync(player)
        } catch (e2) {
            console.error('[魔法师] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e2)
        }
        return { changed: true, collected: collectedInTag(list, tagId), total: tagTotal(tagId) }
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
            console.error('[魔法师] 读取实体类型失败：' + e)
            return
        }
        if (wrapper === null) return

        var entityId = toEntityId(wrapper)
        if (entityId === null) {
            console.error('[魔法师] 无法取得实体注册表 ID，类型=' + String(wrapper))
            return
        }

        var affinity = resolveAffinity(entityId)
        if (affinity === null) return

        var player = resolveKiller(source, entity)
        if (player === null) return

        var result = recordAffinity(player, entityId, affinity.tagId)
        if (!result.changed) return

        /*
         * 提示文本（配色与模组一致：§a 亮点 / §7 灰字 / §8 深灰弱化）：
         *   §a[魔法师] §7记录§a魔法系§7生物 §8» §f<名称> §8[<id>] §8(§a5§7/§f37§8)
         * 末尾括号是收集进度：分子绿色=已收集，分母白色=该系总数。
         */
        var message = Component.literal('§a[魔法师] §7记录§a' + affinity.label + '§7生物 §8» §f')
            .append(getEntityName(entityId))
            .append(Component.literal(' §8[' + entityId + ']'))
            .append(Component.literal(progressText(result.collected, result.total)))
        player.tell(message)
        console.log('[魔法师] 玩家 ' + String(player.username) + ' 击杀' + affinity.label + '生物：' + entityId + '（进度 ' + result.collected + '/' + result.total + '）')
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
            console.error('[魔法师] 处理死亡事件失败：' + e)
        }
    })
})()
