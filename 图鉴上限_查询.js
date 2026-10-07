/*
 * ============================================================
 * 图鉴上限查询 - 复刻 ageofmythology 变形手册的「总数」
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 用途：
 *   模组的变形手册（Fool Book）每个页面都显示「激活/总数: %s/%s」，
 *   其中「总数」不是硬编码，而是运行时按各页面自己的谓词从注册表筛出来的。
 *   本命令把同一套谓词复刻过来，用于给脚本提示里的进度显示提供分母。
 *
 * 来源（模组源码 bettermorph/morph_screen/ManualCatalogFactory.java）：
 *   遗物道具   ForgeRegistries.ITEMS 里 hasTag(ageofmythology:curios/skull)
 *   升级法球   ForgeRegistries.ITEMS 里 instanceof UpgradeOrbItem
 *   矿物方块   ForgeRegistries.BLOCKS 里 is(Tags.Blocks.ORES)
 *   附魔       BuiltInRegistries.ENCHANTMENT 全部
 *   效果       ForgeRegistries.MOB_EFFECTS 全部
 *   伤害类型   level.registryAccess() 的 DAMAGE_TYPE，过滤 generic
 *   法术卷轴   irons_spellbooks SpellRegistry.getEnabledSpells()
 *   生物群系   level.registryAccess() 的 BIOME 全部
 *   结构       server.getStructureManager() 全部
 *   陪伴生物   ForgeRegistries.ENTITY_TYPES 里 CompanionRecordCatalog.canRecord
 *              （即 DefaultAttributes.hasDefaultAttributes）
 *
 * 用法：
 *   /aomcatalog            列出全部类别的「手册总数」，并附各功能脚本里
 *                          写死的上限值作为对照
 *
 * 用途（重要）：
 *   各功能脚本提示里的第三档「上限」是从这里核对出来后写死的常量。
 *   整合包增删内容（加模组、改配置）后，重新执行本命令核对一遍，
 *   再更新对应脚本里的 MAX_* 常量即可，不需要改判据。
 *
 * 实测对照（本整合包 0.3.1）：
 *   遗物道具 951 / 升级法球 14 / 法术 198(手册199) / 附魔 169
 *   效果 671(手册672) / 伤害类型 293(手册332) / 矿物方块 54
 *   陪伴生物 986 / 生物群系 400 / 结构 668 / 营火原料 103 / Create 原料 301
 *
 * ============================================================
 */

(function () {
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[图鉴上限] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var BuiltInRegistries = loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var Registries = loadClass('net.minecraft.core.registries.Registries')
    var ResourceLocation = loadClass('net.minecraft.resources.ResourceLocation')
    var TagKey = loadClass('net.minecraft.tags.TagKey')
    var Items = loadClass('net.minecraft.world.item.Items')

    /* 模组的 curios 头颅槽标签，源码 ItemTagGenerator.CURIOS_SKULL = curios:skull */
    var CURIOS_SKULL = ResourceLocation.parse('curios:skull')

    function itemKeys() {
        return BuiltInRegistries.ITEM.keySet().toArray()
    }

    /*
     * 取注册表的条目数。
     *
     * KubeJS 的 BuiltInRegistries 只暴露了一部分静态字段
     * （BIOME 就不在其中），所以这里给两条路：
     *   1. 静态字段（ITEM / BLOCK / MOB_EFFECT / ENCHANTMENT）
     *   2. 通过 level.registryAccess().registry(ResourceKey) 动态取
     */
    function registrySizeOf(source, fieldName, resourceKey) {
        try {
            var registry = BuiltInRegistries[fieldName]
            if (registry !== undefined && registry !== null) {
                return registry.keySet().toArray().length
            }
        } catch (e) { /* 走下去用动态注册表 */ }
        try {
            var access = source.getLevel().registryAccess()
            var optional = access.registry(resourceKey)
            if (optional.isPresent()) return optional.get().keySet().toArray().length
        } catch (e2) {
            console.error('[图鉴上限] 取注册表 ' + fieldName + ' 失败：' + e2)
        }
        return -1
    }

    /*
     * ------------------------------------------------------------
     * 遗物道具：curios:skull 标签下的全部物品
     *
     * 模组用 ItemStack.is(tag)，KubeJS 包装器上 hasTag 不一定在，
     * 所以两条都试：item.hasTag(id) -> Item.of(id).hasTag(id)。
     * ------------------------------------------------------------
     */
    function isSkullRelic(id) {
        try {
            var item = BuiltInRegistries.ITEM.get(ResourceLocation.parse(id))
            if (item === null) return false
            if (typeof item.hasTag === 'function') return item.hasTag(CURIOS_SKULL)
        } catch (e) { /* 走 ItemStack 通道 */ }
        try {
            return Item.of(id).hasTag(CURIOS_SKULL)
        } catch (e2) {
            return false
        }
    }

    function totalSkullRelics() {
        var count = 0
        try {
            var keys = itemKeys()
            for (var i = 0; i < keys.length; i++) {
                if (isSkullRelic(String(keys[i]))) count++
            }
        } catch (e) {
            console.error('[图鉴上限] 统计 curios:skull 失败：' + e)
        }
        return count
    }

    /*
     * ------------------------------------------------------------
     * 升级法球：直接调用模组自己的判定方法
     *
     * 样例日志已证明物品真实类就是 io.redspace.ironsspellbooks.item.UpgradeOrbItem，
     * 与模组手册的判定完全一致，所以不再自己写 instanceof：
     *   ManualCatalogFactory 用 item instanceof UpgradeOrbItem，
     *   而 createUpgradeOrbEntries 是 private static，
     *   这里换用同语义的公开入口 —— 逐条比对手册用的候选集合大小即可：
     *   UpgradeOrbItem 只有一个公开静态字段时用它反查会更好，
     *   但最稳的是「类名比对」：直接比较 getClass().getName()。
     *
     * Rhino 注意：UpgradeOrbItem.class.isInstance(x) 会把「类名字符串」
     * 作为参数传给 isInstance（日志里 ResourceLocation 解析该字符串报错即证据），
     * 所以改用 getClass().getName() 文本比对，避免 NativeJavaClass 的强制转换。
     * ------------------------------------------------------------
     */
    var ORB_CLASS_NAME = 'io.redspace.ironsspellbooks.item.UpgradeOrbItem'

    function totalUpgradeOrbs() {
        var count = 0
        var hits = []
        try {
            var keys = itemKeys()
            for (var i = 0; i < keys.length; i++) {
                try {
                    var item = BuiltInRegistries.ITEM.get(keys[i])
                    if (item === null) continue
                    if (String(item.getClass().getName()) === ORB_CLASS_NAME) {
                        count++
                        hits.push(String(keys[i]))
                    }
                } catch (e) { /* 跳过 */ }
            }
        } catch (e2) {
            console.error('[图鉴上限] 统计升级法球失败：' + e2)
        }
        console.info('[图鉴上限] 升级法球（按类名 ' + ORB_CLASS_NAME + '）命中 ' + count + ' 个：' + hits.join(', '))
        return count
    }

    /*
     * ------------------------------------------------------------
     * 矿物方块：模组手册判定
     *   block == Blocks.AIR || block.defaultBlockState().is(Tags.Blocks.ORES)
     *
     * 摸清矿石标签到底能不能用：
     *   blockState.is(TagKey) 两次命中 0，
     *   把 TagKey 交给 ItemStack.hasTag 还会抛
     *   「TagKey 被当成 ID 解析」的强制转换异常。
     * 所以这里并排跑两个通道，谁命中就用谁：
     *   通道A：块 id 里含 ore 的方块（不依赖标签系统）
     *   通道B：枚举方块标签注册表，直接读 forge:ores 的成员数
     * 最后 +1（模组把空气也算作一个可吞噬方块）。
     * ------------------------------------------------------------
     */
    function totalOreBlocks(source) {
        /*
         * 模组的判据是 block.defaultBlockState().is(Tags.Blocks.ORES)，
         * 而 blockState.is(TagKey) 在 KubeJS 里点不出结果（两次 0），
         * 所以绕开 is()：直接读方块标签注册表里 forge:ores 的成员数。
         *
         * 同时把所有名字里带 ore 的方块标签都列一遍，
         * 便于确认整合包用的到底是 forge:ores 还是别的名字。
         */
        var bestFromTags = 0
        var bestTagId = ''
        try {
            var tagRegistry = source.getLevel().registryAccess().registry(Registries.BLOCK)
            if (tagRegistry.isPresent()) {
                var reg = tagRegistry.get()
                var tagKeys = reg.getTagNames().toArray()
                for (var t = 0; t < tagKeys.length; t++) {
                    var tagId = String(tagKeys[t].location())
                    if (tagId.indexOf('ore') < 0) continue
                    var holders = reg.getTag(tagKeys[t])
                    var size = 0
                    if (holders.isPresent()) size = holders.get().size()
                    console.info('[图鉴上限] 方块标签 ' + tagId + ' 成员 ' + size + ' 个')
                    if (tagId === 'forge:ores') {
                        bestFromTags = size
                        bestTagId = tagId
                    }
                }
            }
        } catch (e2) {
            console.error('[图鉴上限] 枚举方块标签失败：' + e2)
        }
        console.info('[图鉴上限] 选用标签 ' + bestTagId + ' = ' + bestFromTags)

        /* +1：模组把空气也算作一个可吞噬方块 */
        return bestFromTags + 1
    }

    /*
     * ------------------------------------------------------------
     * 附魔 / 效果：注册表条目数
     * ------------------------------------------------------------
     */
    function totalEnchantments(source) {
        return registrySizeOf(source, 'ENCHANTMENT', Registries.ENCHANTMENT)
    }

    function totalEffects(source) {
        return registrySizeOf(source, 'MOB_EFFECT', Registries.MOB_EFFECT)
    }

    /*
     * ------------------------------------------------------------
     * 生物群系：注册表条目数
     *
     * BuiltInRegistries.BIOME 在 KubeJS 里取不到，必须走
     * level.registryAccess().registry(Registries.BIOME)。
     * ------------------------------------------------------------
     */
    function totalBiomes(source) {
        return registrySizeOf(source, 'BIOME', Registries.BIOME)
    }

    /*
     * ------------------------------------------------------------
     * 伤害类型：注册表条目数
     *
     * 上一版用 keySet().toArray().length 得到 293，游戏内是 332。
     * 这里改成按 entrySet 的 key 计数（与模组 createDamageTypeEntries
     * 的遍历口径一致），并把两个数字都打印出来对比。
     * ------------------------------------------------------------
     */
    function totalDamageTypes(source) {
        var viaKeys = -1
        var viaEntries = -1
        try {
            var registry = source.getLevel().registryAccess().registry(Registries.DAMAGE_TYPE)
            if (!registry.isPresent()) return -1
            var reg = registry.get()
            viaKeys = reg.keySet().toArray().length
            viaEntries = reg.entrySet().toArray().length
        } catch (e) {
            console.error('[图鉴上限] 统计伤害类型失败：' + e)
            return -1
        }
        console.info('[图鉴上限] 伤害类型：keySet=' + viaKeys + ' entrySet=' + viaEntries)
        return viaEntries > 0 ? viaEntries : viaKeys
    }

    /*
     * ------------------------------------------------------------
     * 结构：直接问模组自己的 StructureCatalogService
     *
     * 手册的结构页就是它给的快照（ManualCatalogFactory 走
     * ClientStructureCatalogState，服务端源头是 StructureCatalogService）。
     * 源码 buildSnapshot：结构注册表 id 去掉内部载体
     * ageofmythology:external_template_carrier，再加上外部 .nbt 库。
     * 所以数字必然与手册一致，不需要自己数模板文件。
     * ------------------------------------------------------------
     */
    function totalStructures(source) {
        try {
            var service = loadClass('com.kurome.ageofmythology.structure_construction.catalog.StructureCatalogService')
            if (service === null) {
                console.error('[图鉴上限] StructureCatalogService 不可用')
                return -1
            }
            var snapshot = service.snapshot(source.getServer())
            if (snapshot === null) return -1
            var ids = snapshot.ids()
            console.info('[图鉴上限] 结构快照版本=' + snapshot.version() + ' 条目数=' + ids.size())
            return ids.size()
        } catch (e) {
            console.error('[图鉴上限] 统计结构失败：' + e)
            return -1
        }
    }

    /*
     * ------------------------------------------------------------
     * 法术：irons_spellbooks 已启用的法术（模组用 SpellRegistry.getEnabledSpells）
     * ------------------------------------------------------------
     */
    function totalSpells() {
        try {
            var SpellRegistry = loadClass('io.redspace.ironsspellbooks.api.registry.SpellRegistry')
            if (SpellRegistry === null) return -1
            var spells = SpellRegistry.getEnabledSpells()
            var count = 0
            var iterator = spells.iterator()
            var seen = {}
            while (iterator.hasNext()) {
                try {
                    var spell = iterator.next()
                    if (spell === null || !spell.isEnabled()) continue
                    var id = String(spell.getSpellId())
                    if (seen[id] === true) continue
                    seen[id] = true
                    count++
                } catch (e) { /* 跳过 */ }
            }
            return count
        } catch (e2) {
            console.error('[图鉴上限] 统计法术失败：' + e2)
            return -1
        }
    }

    /*
     * ------------------------------------------------------------
     * 陪伴生物：直接问模组自己的 CompanionRecordCatalog.canRecord
     *
     * 模组 createEntityEntries 就是这个判定，所以数字必然与手册一致。
     * DefaultAttributes 那条路在 KubeJS 里取不到方法（返回 0），已弃用。
     * ------------------------------------------------------------
     */
    function totalCompanionEntities() {
        var count = 0
        try {
            var catalog = loadClass('com.kurome.ageofmythology.item.cat.CompanionRecordCatalog')
            if (catalog === null) {
                console.error('[图鉴上限] CompanionRecordCatalog 不可用')
                return -1
            }
            var types = BuiltInRegistries.ENTITY_TYPE.keySet().toArray()
            for (var i = 0; i < types.length; i++) {
                try {
                    if (catalog.canRecord(BuiltInRegistries.ENTITY_TYPE.get(types[i]))) count++
                } catch (e) { /* 跳过 */ }
            }
        } catch (e2) {
            console.error('[图鉴上限] 统计陪伴生物失败：' + e2)
        }
        return count
    }

    /*
     * ------------------------------------------------------------
     * 输出
     * ------------------------------------------------------------
     */
    function report(source) {
        var out = []
        function line(label, total, note) {
            out.push(label + ' = ' + total + (note ? ' §8' + note : ''))
        }

        line('遗物道具 curios:skull', totalSkullRelics(), '游戏内应为 951')
        line('升级法球 UpgradeOrbItem', totalUpgradeOrbs(), '游戏内应为 14')
        line('法术卷轴（已启用法术）', totalSpells(), '游戏内应为 199')
        line('附魔', totalEnchantments(source), '游戏内应为 169')
        line('效果', totalEffects(source), '游戏内应为 672')
        line('伤害类型（含 generic）', totalDamageTypes(source), '游戏内应为 332')
        line('矿物方块矿石标签', totalOreBlocks(source), '游戏内应为 54')
        line('陪伴生物（有默认属性）', totalCompanionEntities(), '游戏内应为 986')
        line('生物群系', totalBiomes(source), '游戏内应为 400')
        line('结构', totalStructures(source), '游戏内应为 668')

        for (var i = 0; i < out.length; i++) {
            console.log('[图鉴上限] ' + out[i])
            source.sendSuccess(Component.literal('§a[图鉴上限] §f' + out[i]), false)
        }
    }

    ServerEvents.commandRegistry(function (event) {
        var commands = event.commands
        var builder = commands.literal('aomcatalog')
            .executes(function (context) {
                report(context.getSource())
                return 1
            })
        event.register(builder)
    })

    console.log('[图鉴上限] 已加载：/aomcatalog')
})()
