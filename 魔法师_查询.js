/*
 * ============================================================
 * 魔法师·查询 - 游戏内列出 魔法系 / 巫法系 的全部生物
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 用途：
 *   本文件只是「查表工具」，不参与魔法师的记录逻辑，
 *   平时可以删掉；需要核对名单时再放回 server_scripts 并 /reload。
 *
 * 用法：
 *   /aommagicschool            列出两大系全部生物
 *   /aommagicschool magic      只列魔法系（#ageofmythology:magic）
 *   /aommagicschool goety      只列巫法系（#ageofmythology:goety）
 *   /aommagicschool list       列出自己当前已记录的 nbt_magic_skills
 *
 * 输出：
 *   1. 聊天栏分批显示（每批 10 条）
 *   2. 完整名单写入 kubejs/server.log，可用文本编辑器直接搜索
 *
 * 原理：
 *   与魔法师.js 一致 —— 直接遍历实体注册表并查模组标签，
 *   所以这里列出来的名单就是脚本实际会识别的名单；
 *   模组更新后重新执行一次即可，不需要维护任何常量表。
 *   实测：魔法系 37 条 / 巫法系 59 条（goety.json 里有两条重复，去重后 59）。
 *
 * 两个坑：
 *   1. TagKey 的 toString() 是 "TagKey[minecraft:entity_type / xxx:yyy]"
 *      这种包装形式，拿它和 location() 比会永远不相等，
 *      必须比 TagKey.location()。
 *   2. 类加载要用 loadClass 包 try：加载期抛错会让 KubeJS
 *      丢弃整份脚本（现象是命令根本不存在）。
 *
 * ============================================================
 */

(function () {
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[魔法师·查询] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var BuiltInRegistries = loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var ResourceLocation = loadClass('net.minecraft.resources.ResourceLocation')
    var TagKey = loadClass('net.minecraft.tags.TagKey')
    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var AFFINITY_TAGS = [
        ['魔法系', '#ageofmythology:magic'],
        ['巫法系', '#ageofmythology:goety']
    ]

    /*
     * ------------------------------------------------------------
     * 标签 id -> TagKey<EntityType<?>>
     * ------------------------------------------------------------
     */
    function resolveTagKey(tagId) {
        try {
            return TagKey.create(BuiltInRegistries.ENTITY_TYPE.key(), ResourceLocation.parse(tagId.replace('#', '')))
        } catch (e) {
            console.error('[魔法师·查询] 构建实体标签失败：' + tagId + '，错误：' + e)
            return null
        }
    }

    /*
     * ------------------------------------------------------------
     * 实体类型是否属于某个标签
     *
     * 注册表取出的类型直接支持 getTags()，与魔法师.js 的判定口径一致。
     * ------------------------------------------------------------
     */
    function isInTag(type, tagKey) {
        if (type === null || tagKey === null) return false
        try {
            var tags = type.getTags().toArray()
            for (var i = 0; i < tags.length; i++) {
                if (String(tags[i].location()) === String(tagKey.location())) return true
            }
        } catch (e) {
            console.error('[魔法师·查询] 读取实体标签集合失败：' + e)
        }
        return false
    }

    /*
     * ------------------------------------------------------------
     * 收集某个标签下的全部实体注册表 ID（按 ID 排序，方便比对）
     *
     * 用 keySet 遍历：key 本身就是注册表 ID（minecraft:llama），
     * 比实体类型包装器的 toString()（那是翻译键）可读。
     * ------------------------------------------------------------
     */
    function collect(tagId) {
        var tagKey = resolveTagKey(tagId)
        var result = []
        if (tagKey === null) return result
        var keys = BuiltInRegistries.ENTITY_TYPE.keySet().toArray()
        for (var i = 0; i < keys.length; i++) {
            var type = null
            try {
                type = BuiltInRegistries.ENTITY_TYPE.get(keys[i])
            } catch (e) {
                console.error('[魔法师·查询] 取实体类型失败：' + keys[i] + '，错误：' + e)
            }
            if (type !== null && isInTag(type, tagKey)) result.push(String(keys[i]))
        }
        result.sort()
        return result
    }

    /*
     * ------------------------------------------------------------
     * 输出一个系的名单：先写日志，再分批发到聊天栏
     * ------------------------------------------------------------
     */
    function report(source, label, tagId) {
        var list = collect(tagId)
        console.log('[魔法师·查询] ' + label + ' ' + tagId + ' 共 ' + list.length + ' 个：' + list.join(', '))
        source.sendSuccess(Component.literal('§a[魔法师·查询] §f' + label + ' §8' + tagId + ' §7共 §f' + list.length + ' §7个，完整名单见 kubejs/server.log'), false)
        for (var i = 0; i < list.length; i += 10) {
            source.sendSuccess(Component.literal('§8» §f' + list.slice(i, i + 10).join('§7, §f')), false)
        }
        if (list.length === 0) {
            source.sendSuccess(Component.literal('§8» §7（空：标签未加载或写法有误）'), false)
        }
    }

    /*
     * ------------------------------------------------------------
     * 列出玩家当前已记录的 nbt_magic_skills
     * ------------------------------------------------------------
     */
    function reportList(source) {
        var player = source.getPlayer()
        if (player === null) {
            source.sendFailure(Component.literal('§c[魔法师·查询] 该命令需要由玩家执行'))
            return
        }
        var data = null
        try {
            data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
        } catch (e) {
            console.error('[魔法师·查询] 读取 capability 失败：' + e)
        }
        if (data === null) {
            source.sendFailure(Component.literal('§c[魔法师·查询] 取不到 capability'))
            return
        }
        var map = data.getExtraInfo().magic_skills
        var keys = map.keySet().toArray()
        var lines = []
        for (var i = 0; i < keys.length; i++) {
            try {
                lines.push(String(BuiltInRegistries.ENTITY_TYPE.getKey(keys[i])) + '=' + map.get(keys[i]))
            } catch (e2) {
                lines.push(String(keys[i]) + '=?')
            }
        }
        console.log('[魔法师·查询] 已记录 ' + lines.length + ' 条：' + lines.join(', '))
        source.sendSuccess(Component.literal('§a[魔法师·查询] §7已记录 §f' + lines.length + ' §7条，明细见 kubejs/server.log'), false)
        for (var k = 0; k < lines.length; k += 6) {
            source.sendSuccess(Component.literal('§8» §f' + lines.slice(k, k + 6).join('§7, §f')), false)
        }
    }

    /*
     * ------------------------------------------------------------
     * 注册命令 /aommagicschool [magic|goety|list]
     * ------------------------------------------------------------
     */
    ServerEvents.commandRegistry(function (event) {
        var commands = event.commands
        var builder = commands.literal('aommagicschool')
            .executes(function (context) {
                var source = context.getSource()
                for (var i = 0; i < AFFINITY_TAGS.length; i++) report(source, AFFINITY_TAGS[i][0], AFFINITY_TAGS[i][1])
                return 1
            })
            .then(commands.literal('magic').executes(function (context) {
                report(context.getSource(), '魔法系', AFFINITY_TAGS[0][1])
                return 1
            }))
            .then(commands.literal('goety').executes(function (context) {
                report(context.getSource(), '巫法系', AFFINITY_TAGS[1][1])
                return 1
            }))
            .then(commands.literal('list').executes(function (context) {
                reportList(context.getSource())
                return 1
            }))
        event.register(builder)
    })

    console.log('[魔法师·查询] 已加载：/aommagicschool [magic|goety|list]')
})()
