/*
 * ============================================================
 * 悬停提示工具（被各功能脚本共用）
 *
 * 用途：在聊天文本上挂 Minecraft 原生的悬停提示。
 *   hoverItem(组件, 物品id, nbt)  -> show_item，鼠标移上去显示物品卡片
 *   hoverText(组件, 行数组)       -> show_text，鼠标移上去显示自定义文字
 *
 * ------------------------------------------------------------
 * 为什么写得这么"绕"：KubeJS 把这些官方入口全屏蔽了，实测记录如下
 *
 *   HoverEvent.showItem(...)   -> has no public method named "showItem"
 *   HoverEvent.showText(...)   -> has no public method named "showText"
 *   Action.buildHoverEvent(t)  -> Cannot find function buildHoverEvent
 *   Component$Serializer.fromJson(x)
 *                              -> 重载歧义（String 与 JsonElement 分不清）
 *   包装器 .itemStack / .minecraftItemStack / .getItemStack
 *                              -> 全部取不到原生 ItemStack
 *   component.withStyle(回调)  -> JavaException: argument type mismatch
 *
 * 唯一可行的组合（已实测通过）：
 *   1. 原生 ItemStack 自己 new：BuiltInRegistries.ITEM.get(...) + new ItemStack(item)
 *   2. 物品悬停的值必须是 HoverEvent$ItemStackInfo 实例（record）
 *      —— 传 SNBT 字符串或 Component 都会让客户端渲染悬停时崩：
 *         ClassCastException: String/MutableComponent
 *           cannot be cast to HoverEvent$ItemStackInfo
 *   3. 文字悬停的值就是 Text，传 Component 即可（与物品恰好相反，不能统一处理）
 *   4. 挂载用 Style.EMPTY.withHoverEvent(event) + component.setStyle(style)
 *
 * 本文件必须排在其它脚本之前加载（文件名以 _ 开头，
 * server_scripts 按名称排序加载），否则 global.hover 还是 undefined。
 * ============================================================
 */

global.hover = (function () {
    function tryLoad(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[悬停工具] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var HoverEventClass = tryLoad('net.minecraft.network.chat.HoverEvent')
    var HoverAction = tryLoad('net.minecraft.network.chat.HoverEvent$Action')
    var HoverItemStackInfo = tryLoad('net.minecraft.network.chat.HoverEvent$ItemStackInfo')
    var StyleClass = tryLoad('net.minecraft.network.chat.Style')
    var ItemsClass = tryLoad('net.minecraft.world.item.Items')
    var ItemStackClass = tryLoad('net.minecraft.world.item.ItemStack')
    var BuiltInRegistriesClass = tryLoad('net.minecraft.core.registries.BuiltInRegistries')
    var ResourceLocationClass = tryLoad('net.minecraft.resources.ResourceLocation')
    var TagParser = tryLoad('net.minecraft.nbt.TagParser')

    var ready = (HoverEventClass !== null && HoverAction !== null && HoverItemStackInfo !== null &&
        StyleClass !== null && ItemsClass !== null && ItemStackClass !== null &&
        BuiltInRegistriesClass !== null && ResourceLocationClass !== null)

    /* 没有可用 NBT 设置方法时只提示一次，避免刷屏 */
    var warnedNoNbt = false

    /*
     * 由物品 id 构造原生 ItemStack。
     *
     * 取不到对应 Item（拼错的 id、纯方块 id 等）时退化为石头，
     * 这样 tooltip 至少有个图标，而提示文本里的原 ID 不受影响。
     */
    function nativeStackOf(itemId) {
        if (!ready) return null
        var id = (itemId === null || itemId === undefined) ? '' : String(itemId)
        if (id.length > 0) {
            try {
                var item = BuiltInRegistriesClass.ITEM.get(ResourceLocationClass.parse(id))
                if (item !== null && item !== undefined && item !== ItemsClass.AIR) {
                    return new ItemStackClass(item)
                }
            } catch (e) { /* 落到兜底 */ }
        }
        try {
            return new ItemStackClass(ItemsClass.STONE)
        } catch (e2) {
            console.error('[悬停工具] 无法构造原生 ItemStack：' + e2)
            return null
        }
    }

    /*
     * 把 HoverEvent 挂到组件上，返回一个**全新**的组件。
     *
     * 三个必须遵守的约束（都踩过）：
     *   1. Component.literal / translatable 会返回**缓存或共享实例**，
     *      原地 setStyle 会把样式泄漏到所有引用它的地方；
     *   2. MutableComponent.append(...) 是**原地修改**，所以绝不能拿
     *      已挂悬停的组件当基底去 append 后面的文字 —— 否则整条消息
     *      都会弹出那个悬停（曾出现：中间的"发现新的遗物 »"和末尾的
     *      进度括号都弹出了道具信息）；
     *   3. 子组件会继承父组件样式，所以父级必须显式清空样式。
     *
     * 做法：把文本取出来、按给的样式重建一个只含纯文本的新组件，
     * 这样既不复用共享实例，也不带任何可继承的悬停。
     */
    function rebuild(component, style) {
        var text = ''
        try {
            text = String(component.getString())
        } catch (e) {
            text = String(component)
        }
        var out = Component.literal(text)
        try {
            out.setStyle(style)
        } catch (e2) {
            /* 样式设置失败就退化为纯文本，至少不能崩 */
        }
        return out
    }

    function applyHover(component, hoverEvent) {
        if (component === null || component === undefined) return component
        if (hoverEvent === null || hoverEvent === undefined || !ready) return component
        try {
            var hoverStyle = StyleClass.EMPTY.withHoverEvent(hoverEvent)
            return rebuild(component, hoverStyle)
        } catch (e) {
            console.error('[悬停工具] 挂载悬停失败：' + e)
            return component
        }
    }

    /*
     * 去掉组件上的悬停（用于把"已经挂过悬停的组件"当基底之前先净化）
     */
    function stripHover(component) {
        if (component === null || component === undefined || !ready) return component
        try {
            return rebuild(component, StyleClass.EMPTY)
        } catch (e) {
            return component
        }
    }

    /*
     * 物品悬停：component 上挂 show_item
     *
     * nbt 可以省略（传 null）。传了就给原生栈套上 NBT，
     * 这样 tooltip 会带上附魔、自定义名称等内容。
     *
     * 注意方法名：本环境里 KubeJS 只暴露「Nbt 命名」那一套
     * （setNbt / getNbt / getOrCreateTag / getTagElement），
     * setTag / getTag 是 undefined —— 见下面 hoverItemWithSnbt 的注释。
     */
    function hoverItem(component, itemId, nbt) {
        if (!ready) return component
        try {
            var stack = nativeStackOf(itemId)
            if (stack === null) return component

            var hasTag = false
            try {
                hasTag = (nbt !== null && nbt !== undefined && typeof nbt.copy === 'function' && !nbt.isEmpty())
            } catch (eTag) {
                hasTag = false
            }
            if (hasTag && TagParser !== null) {
                try {
                    var tag = TagParser.parseTag(String(nbt))
                    if (tag !== null) applyNbt(stack, tag)
                } catch (eNbt) {
                    /* NBT 套不上不影响悬停，忽略 */
                }
            }

            var info = new HoverItemStackInfo(stack)
            return applyHover(component, new HoverEventClass(HoverAction.SHOW_ITEM, info))
        } catch (e) {
            console.error('[悬停工具] 构造物品悬停失败（' + itemId + '）：' + e)
            return component
        }
    }

    /*
     * 给原生 ItemStack 套 NBT。
     *
     * 候选顺序：setNbt（本环境可用）-> setTag -> setTagRaw。
     * 全部失败时只提示一次，避免刷屏。
     */
    function applyNbt(stack, tag) {
        if (stack === null || tag === null) return false
        var candidates = ['setNbt', 'setTag', 'setTagRaw']
        for (var i = 0; i < candidates.length; i++) {
            try {
                if (typeof stack[candidates[i]] === 'function') {
                    stack[candidates[i]](tag)
                    return true
                }
            } catch (e) { /* 试下一个 */ }
        }
        if (!warnedNoNbt) {
            warnedNoNbt = true
            console.error('[悬停工具] 当前环境没有可用的 NBT 设置方法，带 NBT 的悬停卡片会退化为无 NBT 版本。')
        }
        return false
    }

    /*
     * 物品悬停（SNBT 字符串版）
     *
     * 与 hoverItem 的区别：NBT 直接给 SNBT 文本，由这里解析成 CompoundTag。
     * 适合"手工拼一个带特定 NBT 的物品"的场景，例如：
     *   法术卷轴  {Count:1b,id:"irons_spellbooks:scroll",tag:{...spell_container...}}
     *   附魔书    {Count:1b,id:"minecraft:enchanted_book",tag:{StoredEnchantments:[...]}}
     *
     * 这个环境里实测（/aomhoverapi）：
     *   ItemStack.of(CompoundTag)  -> 重载歧义，不可用
     *     （EndingLibrary 通过 mixin 往 ItemStack 注入了同名 of(ItemStack)）
     *   实例方法可用的是「Nbt 命名」那一套：
     *     setNbt=getNbt=getOrCreateTag=getTagElement=addTagElement=function
     *   而 setTag / getTag 是 undefined（KubeJS 只暴露 Nbt 命名）
     *
     * 所以正确写法是：取到原生栈后调 setNbt(tag)，而不是 setTag。
     * ------------------------------------------------------------
     */

    function hoverItemWithSnbt(component, itemId, itemSnbt) {
        if (!ready) return component
        try {
            /*
             * 主路径：原生栈 + setNbt。
             *
             * 实测可用的是 Nbt 命名那一套（setNbt / getNbt /
             * getOrCreateTag / getTagElement / addTagElement），
             * setTag / getTag 在 KubeJS 侧是 undefined。
             * 所以 setNbt 放在第一位，其余只作兼容候选。
             */
            var stack = nativeStackOf(itemId)
            if (stack === null) return component

            if (TagParser !== null) {
                try {
                    var parsed = TagParser.parseTag(String(itemSnbt))
                    if (parsed !== null && parsed.contains('tag')) {
                        applyNbt(stack, parsed.getCompound('tag'))
                    }
                } catch (eTag) {
                    console.error('[悬停工具] 套用 SNBT 失败：' + eTag)
                }
            }

            var info = new HoverItemStackInfo(stack)
            return applyHover(component, new HoverEventClass(HoverAction.SHOW_ITEM, info))
        } catch (e) {
            console.error('[悬停工具] 构造 SNBT 物品悬停失败（' + itemId + '）：' + e)
            return component
        }
    }

    /*
     * 文字悬停：component 上挂 show_text
     *
     * lines 是字符串数组，会被换行拼成多行 tooltip。
     * 空数组或全空行时不挂悬停，直接返回原组件。
     */
    function hoverText(component, lines) {
        if (!ready || lines === null || lines === undefined) return component
        try {
            var shown = 0
            for (var i = 0; i < lines.length; i++) {
                if (lines[i] !== null && lines[i] !== undefined && String(lines[i]).length > 0) shown++
            }
            if (shown === 0) return component
            var event = new HoverEventClass(HoverAction.SHOW_TEXT, Component.literal(lines.join('\n')))
            return applyHover(component, event)
        } catch (e) {
            console.error('[悬停工具] 构造文字悬停失败：' + e)
            return component
        }
    }

    /*
     * 供脚本自检：把关键类是否就绪写到日志
     */
    function check() {
        console.info('[悬停工具] 就绪=' + ready +
            ' HoverEvent=' + (HoverEventClass !== null) +
            ' Action=' + (HoverAction !== null) +
            ' ItemStackInfo=' + (HoverItemStackInfo !== null) +
            ' Style=' + (StyleClass !== null) +
            ' ItemStack=' + (ItemStackClass !== null))
        return ready
    }

    /*
     * 诊断：打印某个 native ItemStack 上到底有哪些 NBT 相关方法可用。
     * 只在排查「取不到某个方法」时手动调用，正常运行不输出。
     */
    function probeStackMethods(itemId) {
        try {
            var stack = nativeStackOf(itemId)
            if (stack === null) {
                console.info('[悬停工具诊断] ' + itemId + '：取不到原生栈')
                return
            }
            var names = ['setTag', 'setNbt', 'getTag', 'getNbt', 'getOrCreateTag', 'isEmpty', 'getItem', 'getCount']
            var result = []
            for (var i = 0; i < names.length; i++) {
                result.push(names[i] + '=' + (typeof stack[names[i]]))
            }
            console.info('[悬停工具诊断] ' + itemId + ' 方法探测: ' + result.join(', '))
        } catch (e) {
            console.error('[悬停工具诊断] 失败：' + e)
        }
    }

    return {
        ready: ready,
        hoverItem: hoverItem,
        hoverItemWithSnbt: hoverItemWithSnbt,
        probeStackMethods: probeStackMethods,
        hoverText: hoverText,
        nativeStackOf: nativeStackOf,
        stripHover: stripHover,
        check: check
    }
})()

console.info('[悬停工具] global.hover 已注册，就绪=' + global.hover.ready)
