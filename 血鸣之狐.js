/*
 * ============================================================
 * 血鸣之狐 - 记录可用于营火烹饪的物品
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 当玩家获得物品时触发检测。
 *   2. 自动扫描游戏中的全部 minecraft:campfire_cooking 配方。
 *   3. 如果玩家获得的物品可以作为某个营火配方的原料，
 *      就将该物品 ID 记录到：
 *
 *      ForgeCaps."ageofmythology:traveller"
 *        .nbt_blood_fox_item
 *
 *   4. 使用 Minecraft 原生 Ingredient 进行原料匹配，
 *      支持：
 *
 *        - 直接 item
 *        - tag
 *        - Ingredient 数组
 *
 *      例如：
 *
 *        {
 *          "type": "minecraft:campfire_cooking",
 *          "ingredient": {
 *            "item": "minecraft:beef"
 *          }
 *        }
 *
 *      或：
 *
 *        {
 *          "type": "minecraft:campfire_cooking",
 *          "ingredient": {
 *            "tag": "forge:raw_meat"
 *          }
 *        }
 *
 *      都可以被正确识别。
 *
 *   5. 已存在的物品不会重复添加。
 *   6. 发现新的营火原料时提示玩家。
 *
 * 数据格式：
 *
 *   ForgeCaps."ageofmythology:traveller"
 *     .nbt_blood_fox_item
 *
 *   [
 *     {
 *       item: "minecraft:beef"
 *     },
 *     {
 *       item: "alexsmobsdelight:raw_tusklin_meat"
 *     }
 *   ]
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var BuiltInRegistries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[血鸣之狐] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var CAMPFIRE_TYPE = 'minecraft:campfire_cooking'
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_blood_fox_item'

    /*
     * 收集进度的「目标」：模组自己的成就阈值
     *   FoxOfBloodEchoItem 里 getBonusCount(player) >= 32
     */
    var GOAL_COUNT = 32

    /*
     * 收集进度的「上限」：本整合包内可作为营火原料的物品数。
     * 由本脚本的配方扫描结果决定（营火 Ingredient 去重后可匹配的物品数），
     * 与 reload 后的汇总日志一致，实测 103。
     */
    var MAX_COUNT = 103

    /*
     * ------------------------------------------------------------
     * 悬停提示
     *
     * 实现放在 _悬停.js（global.hover）：
     * 前缀 [血鸣之狐] 挂本体道具；营火原料名称挂该物品。
     * ------------------------------------------------------------
     */
    function hoverItem(component, itemId, nbt) {
        try {
            return global.hover.hoverItem(component, itemId, nbt)
        } catch (e) {
            console.error('[血鸣之狐] 悬停工具不可用：' + e)
            return component
        }
    }

    /*
     * 本脚本对应的本体道具（脚本名 = 道具名）
     */
    var SCRIPT_ITEMS = {
        '血鸣之狐': 'ageofmythology:ageofmythology_fox_of_blood_echo_item'
    }

    /*
     * 组装进度标记，三档：当前 / 目标 / 上限
     *   §8(§a261§7/§e32§7/§f103§8)
     */
    function progressText(collected, goal, max) {
        return ' §8(§a' + collected + '§7/§e' + goal + '§7/§f' + max + '§8)'
    }

    /*
     * 保存所有营火配方的 Ingredient。
     *
     * 保留 Minecraft 原生 Ingredient 进行匹配，这样可以自动处理：
     *
     *   {"item":"minecraft:beef"}
     *
     *   {"tag":"forge:raw_meat"}
     *
     * 并且保留 NBT 之类的附加匹配条件（Ingredient.test 才是权威判定）。
     *
     * ingredientSignatures 用来去重：
     *   同一 Ingredient 会被多个配方引用，重复收集只会让计数虚高。
     *   这里用「展开后的物品 id 排序拼接」当签名，
     *   因为 Ingredient 本身没有重写 toString/hashCode，不能用字符串去重。
     *
     * 注意：不能用 new java.util.HashSet()，
     * KubeJS 6 已移除 java() 语法，会在加载期直接报错并丢弃整份脚本。
     */
    var campfireIngredients = []
    var ingredientSignatures = {}

    /*
     * --------------------------------------------------------
     * 获取 Item 本地化名称
     *
     * 不能直接使用：item.getName()
     * 因为这里的 item 是 KubeJS ItemStack 包装对象，不是 Minecraft 原生 ItemStack。
     * 也不能简单拼接：item.<namespace>.<path>
     * 因为部分 Mod 可以自定义 Item 的 descriptionId。
     *
     * 正确方式：
     *   KubeJS ItemStack
     *       ↓
     *   Minecraft 原生 Item
     *       ↓
     *   Item#getDescriptionId()
     *       ↓
     *   Component.translatable()
     *
     * 例如：
     *   minecraft:gold_ore → item.minecraft.gold_ore
     *
     * 某些 Mod 如果使用了自定义 descriptionId，
     * 则会自动使用 Mod 自己定义的翻译键。
     * --------------------------------------------------------
     */
    function getItemName(item) {
        try {
            var mcItem = item.getItem()
            var translationKey = mcItem.getDescriptionId()
            return Component.translatable(translationKey)
        } catch (e) {
            console.error('[血鸣之狐] 获取 Item 本地化名称失败：' + e)
            try {
                return Component.literal(String(item.getId()))
            } catch (e2) {
                return Component.literal('未知物品')
            }
        }
    }

    /*
     * ============================================================
     * 扫描全部营火配方
     *
     * 数据源用原版 RecipeManager，而不是 KubeJS 的
     * ServerEvents.recipes 事件 —— 实测：
     *   /reload          该事件会触发（能扫到全量配方）
     *   重新进入存档      该事件会触发
     *   新存档首次进入    该事件不触发（脚本注册错过窗口），
     *                     而 ServerEvents.loaded 稳定触发，
     *                     此时 getRecipeManager() 已有全部配方。
     * 所以统一在 loaded 里读 RecipeManager，只保留一条数据路径。
     * ============================================================
     */
    function scanRecipes(recipeManager) {
        var recipeCount = 0
        var campfireCount = 0
        var ingredientCount = 0

        var recipes = recipeManager.getRecipes()
        var iterator = recipes.iterator()

        while (iterator.hasNext()) {
            try {
                var recipe = iterator.next()
                recipeCount++

                if (String(recipe.getType()) !== CAMPFIRE_TYPE) continue

                campfireCount++

                /*
                 * 原版 AbstractCookingRecipe.getIngredients() 返回
                 * 长度为 1 的 List<Ingredient>，直接取用即可，
                 * 比从 JSON 重建更精确（NBT 条件不会丢）。
                 */
                var ingredients = recipe.getIngredients()
                if (ingredients === null || ingredients.isEmpty()) continue

                for (var i = 0; i < ingredients.size(); i++) {
                    try {
                        var ingredient = ingredients.get(i)
                        if (ingredient === null) continue

                        /*
                         * 按展开后的物品 id 集合去重：
                         * 同一 Ingredient 被多个营火配方引用时只收一次。
                         */
                        var signature = ingredientSignature(ingredient)
                        if (ingredientSignatures[signature] === true) continue

                        ingredientSignatures[signature] = true
                        campfireIngredients.push(ingredient)
                        ingredientCount++
                    } catch (e) {
                        console.error('[血鸣之狐] 解析营火 Ingredient #' + i + ' 失败：' + e)
                    }
                }
            } catch (e) {
                console.error('[血鸣之狐] 扫描营火配方失败：' + e)
            }
        }

        console.info('[血鸣之狐] 配方扫描完成：全部 ' + recipeCount + ' 个，营火 ' + campfireCount + ' 个，营火原料 ' + ingredientCount + ' 个。')
    }

    /*
     * ============================================================
     * 取出一个 Ingredient 覆盖的全部物品 id
     *
     * 优先用原版 Ingredient.getItems()（Tag 会被展开）。
     * 但实测本环境下 KubeJS 的 Ingredient 包装对象**没有** getItems，
     * 所以必须准备兜底：遍历物品注册表并用 Ingredient.test 逐一试探。
     * 扫描只在服务器加载时跑一次（营火配方约 100 条），可以接受。
     * ============================================================
     */
    var fallbackItems = null

    function allItemIds() {
        if (fallbackItems !== null) return fallbackItems
        var list = []
        var iterator = BuiltInRegistries.ITEM.keySet().toArray()
        for (var i = 0; i < iterator.length; i++) {
            try {
                list.push(String(iterator[i]))
            } catch (e) {
                console.error('[血鸣之狐] 收集物品 id 失败：' + e)
            }
        }
        list.sort()
        fallbackItems = list
        return list
    }

    function ingredientSignature(ingredient) {
        var signature = ''
        try {
            var stacks = ingredient.getItems()
            for (var i = 0; i < stacks.length; i++) signature = signature + String(stacks[i]) + '|'
        } catch (e) {
            /*
             * getItems 不可用：用「能通过 test 的物品 id」拼签名。
             */
            var ids = allItemIds()
            for (var k = 0; k < ids.length; k++) {
                try {
                    if (ingredient.test(Item.of(ids[k]))) signature = signature + ids[k] + '|'
                } catch (e2) {
                    /* 单个物品试探失败就跳过 */
                }
            }
        }
        if (signature === '') signature = 'unknown:' + ingredient.toString()
        return signature
    }

    /*
     * ============================================================
     * 判断 ItemStack 是否可以作为营火原料
     * ============================================================
     *
     * Ingredient.test(ItemStack) 会自动处理：
     *
     *   - 直接 item
     *   - item tag
     *   - Ingredient 内部匹配规则
     *
     * 因此这里不需要手动展开 Tag。
     */
    function isCampfireIngredient(item) {
        for (var i = 0; i < campfireIngredients.length; i++) {
            try {
                if (campfireIngredients[i].test(item)) return true
            } catch (e) {
                console.error('[血鸣之狐] Ingredient 匹配失败 #' + i + '：' + e)
            }
        }

        return false
    }

    /*
     * ============================================================
     * 添加 NBT 记录
     * ============================================================
     */
    function addRecord(list, itemId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('item') === itemId) return false
            } catch (e) {
                console.error('[血鸣之狐] 读取已有记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('item', itemId)
        list.add(tag)
        return true
    }

    /*
     * ============================================================
     * 检测玩家获得的物品
     * ============================================================
     */
    function process(player, item) {
        if (item === null || item.isEmpty()) return

        var itemId = String(item.getId())

        /*
         * 判断该物品是否符合任意营火配方 Ingredient。
         */
        if (!isCampfireIngredient(item)) return

        /*
         * ========================================================
         * 读取玩家 ForgeCaps
         * ========================================================
         */
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound(TRAVELLER_CAP)
        var items = traveller.contains(RECORD_LIST) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

        /*
         * 已经记录过就不再重复添加。
         */
        if (!addRecord(items, itemId)) return

        /*
         * 写回玩家 NBT。
         *
         * 显式重新写回：
         *   items
         *     ↓
         *   traveller
         *     ↓
         *   ForgeCaps
         *     ↓
         *   playerNbt
         *
         * 避免 ForgeCaps 或 traveller 原本不存在时，
         * 新创建的 CompoundTag 没有真正挂回父节点。
         */
        traveller.put(RECORD_LIST, items)
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

        /*
         * 提示玩家发现新的营火原料。
         */
        var itemName = getItemName(item)
        var prefix = hoverItem(Component.literal('§a[血鸣之狐]'), SCRIPT_ITEMS['血鸣之狐'], null)
        var message = Component.literal('')
            .append(prefix)
            .append(Component.literal(' §7发现新的营火原料 §8» §f'))
            .append(hoverItem(itemName, itemId, null))
            .append(Component.literal(' §8[' + itemId + ']'))
            .append(Component.literal(progressText(items.size(), GOAL_COUNT, MAX_COUNT)))
        player.tell(message)
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
            console.error('[血鸣之狐] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    /*
     * ============================================================
     * 配方扫描调度
     *
     * 为什么需要「双时机 + 兜底」：
     *   实测各事件的表现不一致：
     *     ServerEvents.recipes   新存档首次进入不触发
     *     ServerEvents.afterRecipes  当前版本根本不触发
     *     ServerEvents.loaded    进入存档会触发，但 /reload 时不可靠
     *   所以这里不再赌单一事件：
     *     1) 脚本加载时若配方表已就绪（/reload 属于这种情况），立即扫；
     *     2) ServerEvents.loaded 触发时补扫（进入存档走这条）；
     *     3) ServerEvents.tick 每 20 tick 检查一次，
     *        一旦配方表就绪且还没扫过就补扫（最后兜底）。
     *   用 didScan 保证只扫一次，不会重复刷日志。
     * ============================================================
     */
    var didScan = false

    /*
     * 安全取当前服务器：脚本加载期与运行期都可能读到 null，
     * 这里统一转成 null 处理，避免裸调用 Server.getServer() 抛错。
     */
    function currentServer() {
        try {
            var s = Server.getServer()
            return (s === null || s === undefined) ? null : s
        } catch (e) {
            return null
        }
    }

    function recipeManagerOf(server) {
        if (server === null) return null
        try {
            var manager = server.getRecipeManager()
            if (manager === null) return null
            if (manager.getRecipes().isEmpty()) return null
            return manager
        } catch (e) {
            return null
        }
    }

    function scanOnce(server, reason) {
        if (didScan) return
        var manager = recipeManagerOf(server === null || server === undefined ? currentServer() : server)
        if (manager === null) return
        didScan = true
        try {
            console.info('[血鸣之狐] 开始扫描配方（触发时机：' + reason + '）')
            scanRecipes(manager)
        } catch (e) {
            console.error('[血鸣之狐] 扫描配方失败：' + e)
        }
    }

    /*
     * 入口一：脚本加载时立刻尝试（/reload 场景，此时配方表通常已就绪）
     */
    scanOnce(null, '脚本加载')

    /*
     * 入口二：服务器加载完成后补扫（进入存档场景）
     */
    try {
        ServerEvents.loaded(function (event) {
            scanOnce(event.server, 'loaded')
        })
    } catch (e) {
        console.error('[血鸣之狐] 注册 ServerEvents.loaded 失败（将由 tick 兜底）：' + e)
    }

    /*
     * 入口三：轮询兜底，防止前两个时机的配方表都还没就绪
     */
    ServerEvents.tick(function (event) {
        try {
            if (didScan) return
            if (event.server.getTickCount() % 20 !== 0) return
            scanOnce(event.server, 'tick 兜底')
        } catch (e) {
            console.error('[血鸣之狐] tick 兜底扫描失败：' + e)
        }
    })

    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()