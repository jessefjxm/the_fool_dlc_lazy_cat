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
        console.info('[血鸣之狐] 开始扫描全部配方，寻找营火配方。')

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
                var recipeId = String(recipe.getId())
                console.info('[血鸣之狐] 找到营火配方：' + recipeId)

                /*
                 * 原版 AbstractCookingRecipe.getIngredients() 返回
                 * 长度为 1 的 List<Ingredient>，直接取用即可，
                 * 比从 JSON 重建更精确（NBT 条件不会丢）。
                 */
                var ingredients = recipe.getIngredients()
                if (ingredients === null || ingredients.isEmpty()) {
                    console.info('[血鸣之狐] 营火配方没有 ingredient：' + recipeId)
                    continue
                }

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
                        console.info('[血鸣之狐] 已记录营火 Ingredient：' + recipeId + ' #' + i)
                    } catch (e) {
                        console.error('[血鸣之狐] 解析营火 Ingredient #' + i + ' 失败：' + e)
                    }
                }
            } catch (e) {
                console.error('[血鸣之狐] 扫描营火配方失败：' + e)
            }
        }

        console.info('[血鸣之狐] 全部配方扫描完成：' + recipeCount + ' 个。')
        console.info('[血鸣之狐] 找到营火配方：' + campfireCount + ' 个。')
        console.info('[血鸣之狐] 找到营火 Ingredient：' + ingredientCount + ' 个。')
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

        console.info('[血鸣之狐] 检测获得物品：' + itemId)

        /*
         * 判断该物品是否符合任意营火配方 Ingredient。
         */
        if (!isCampfireIngredient(item)) return

        console.info('[血鸣之狐] 发现营火原料：' + itemId)

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
        var message = Component.literal('§a[血鸣之狐] §7发现新的营火原料 §8» §f').append(itemName).append(Component.literal(' §8[' + itemId + ']'))
        player.tell(message)

        console.info('[血鸣之狐] 已记录营火原料：' + itemId)
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
     * 注册事件
     *
     * 只用 ServerEvents.loaded：
     *   实测 ServerEvents.recipes 在新存档首次进入时不触发，
     *   afterRecipes 在当前版本根本不触发，
     *   只有 loaded 在「reload / 重新进入 / 开新档」三种情况下都触发，
     *   且此时 RecipeManager 已装载完毕（实测 12631 条）。
     *
     * 用 try 包住：万一该事件在当前 KubeJS 版本里不可用，
     * 也只损失扫描功能，不会让整份脚本加载失败。
     * ============================================================
     */
    try {
        ServerEvents.loaded(function (event) {
            try {
                scanRecipes(event.server.getRecipeManager())
            } catch (e) {
                console.error('[血鸣之狐] 扫描配方失败：' + e)
            }
        })
    } catch (e) {
        console.error('[血鸣之狐] 注册 ServerEvents.loaded 失败（配方扫描将不可用）：' + e)
    }

    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()