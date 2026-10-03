/*
 * ============================================================
 * 共振之狐 - 记录 Create 石磨 / 粉碎轮原料
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 扫描游戏内全部配方。
 *   2. 识别 Create 石磨配方：create:milling
 *   3. 识别 Create 粉碎轮配方：create:crushing
 *   4. 读取配方 ingredients 中的 item / tag。
 *   5. 对 Item Tag 自动展开为全部实际物品。
 *   6. 玩家获得上述物品时，将物品 ID 写入玩家 NBT：
 *
 *      ForgeCaps."ageofmythology:traveller".nbt_resonance_fox_item
 *
 * NBT 格式：
 *   [
 *     { item: "minecraft:cobblestone" },
 *     { item: "create:raw_zinc" },
 *     { item: "regions_unexplored:fireweed" }
 *   ]
 *
 * 注意：
 *   数据源是原版 RecipeManager（在 ServerEvents.loaded 里读），
 *   不再解析 KubeJS 配方事件 —— 该事件在新存档首次进入时不触发。
 *   Ingredient.getItems() 在本环境缺失，取物品时用
 *   Ingredient.test + 注册表枚举兜底，见 ingredientItemIds()。
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
            console.error('[共振之狐] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_resonance_fox_item'
    var RECIPE_TYPES = { 'create:milling': true, 'create:crushing': true }
    var millingCount = 0
    var crushingCount = 0
    var ingredientCount = 0
    var crushingItems = {}

    /*
     * ============================================================
     * 记录可用作石磨 / 粉碎轮原料的物品
     * ============================================================
     */
    function addProcessingItem(itemId, source) {
        if (itemId === null || itemId === undefined) return false
        itemId = String(itemId)
        if (itemId === '' || crushingItems[itemId]) return false
        crushingItems[itemId] = true
        return true
    }

    /*
     * ============================================================
     * 取出一个 Ingredient 覆盖的全部物品 id
     *
     * 优先用原版 Ingredient.getItems()（Tag 会被展开）。
     * 但实测本环境下 KubeJS 的 Ingredient 包装对象**没有** getItems
     * （报错：Cannot find function getItems in object ...Ingredient），
     * 所以必须有兜底：遍历物品注册表，用 Ingredient.test 逐一试探。
     * 扫描只在服务器加载时跑一次（本包 Create 相关配方约 200 条），
     * 开销可以接受。
     * ============================================================
     */
    var fallbackItemIds = null

    function allItemIds() {
        if (fallbackItemIds !== null) return fallbackItemIds
        var list = []
        var keys = BuiltInRegistries.ITEM.keySet().toArray()
        for (var i = 0; i < keys.length; i++) {
            try {
                list.push(String(keys[i]))
            } catch (e) {
                console.error('[共振之狐] 收集物品 id 失败：' + e)
            }
        }
        list.sort()
        fallbackItemIds = list
        return list
    }

    function ingredientItemIds(ingredient) {
        var ids = []
        try {
            var stacks = ingredient.getItems()
            for (var i = 0; i < stacks.length; i++) {
                try {
                    var stack = stacks[i]
                    if (stack === null || stack.isEmpty()) continue
                    ids.push(String(BuiltInRegistries.ITEM.getKey(stack.getItem())))
                } catch (e) {
                    console.error('[共振之狐] 读取 Ingredient 物品失败：' + e)
                }
            }
            return ids
        } catch (e2) {
            /*
             * getItems 不存在：枚举注册表反推。
             * Ingredient.test(ItemStack) 才是权威判定，
             * Tag 与 NBT 条件都会被它正确处理。
             */
        }
        var all = allItemIds()
        for (var k = 0; k < all.length; k++) {
            try {
                if (ingredient.test(Item.of(all[k]))) ids.push(all[k])
            } catch (e3) {
                /* 单个物品试探失败就跳过 */
            }
        }
        return ids
    }

    /*
     * ============================================================
     * 扫描全部 Recipe
     *
     * 只处理：
     *   create:milling
     *   create:crushing
     *
     * 两种配方统一记录到 crushingItems。
     *
     * 数据源用原版 RecipeManager，而不是 KubeJS 的
     * ServerEvents.recipes 事件 —— 实测：
     *   /reload          该事件会触发（能扫到全量配方）
     *   重新进入存档      该事件会触发
     *   新存档首次进入    该事件不触发（脚本注册错过窗口），
     *                     而 ServerEvents.loaded 稳定触发，
     *                     此时 getRecipeManager() 已有全部配方。
     *
     * Create 的 ProcessingRecipe 实现原版 Recipe 接口，
     * getIngredients() 返回的就是它的 Ingredient 列表，
     * 比从 JSON 重建更可靠（Tag / NBT 条件都由原版处理）。
     * ============================================================
     */
    function scanRecipes(recipeManager) {
        var recipes = recipeManager.getRecipes()
        var iterator = recipes.iterator()

        while (iterator.hasNext()) {
            try {
                var recipe = iterator.next()
                var type = String(recipe.getType())
                if (!RECIPE_TYPES[type]) continue

                var recipeId = String(recipe.getId())
                if (type === 'create:milling') millingCount++
                else if (type === 'create:crushing') crushingCount++

                var ingredients = recipe.getIngredients()
                if (ingredients === null || ingredients.isEmpty()) continue

                for (var i = 0; i < ingredients.size(); i++) {
                    try {
                        ingredientCount++

                        /*
                         * 取该 Ingredient 覆盖的物品 id：
                         * 优先 getItems()，缺失时用注册表 + test 反推。
                         */
                        var ids = ingredientItemIds(ingredients.get(i))
                        for (var k = 0; k < ids.length; k++) {
                            addProcessingItem(ids[k], recipeId)
                        }
                    } catch (e) {
                        console.error('[共振之狐] 解析 Ingredient #' + i + ' 失败：' + e + ' ← ' + recipeId)
                    }
                }
            } catch (e) {
                console.error('[共振之狐] 扫描 Recipe 失败：' + e)
            }
        }

        var totalItems = 0
        for (var id in crushingItems) if (crushingItems[id]) totalItems++

        console.info('[共振之狐] ========================================')
        console.info('[共振之狐] Create 石磨配方：' + millingCount + ' 个')
        console.info('[共振之狐] Create 粉碎轮配方：' + crushingCount + ' 个')
        console.info('[共振之狐] 总 Ingredient：' + ingredientCount + ' 个')
        console.info('[共振之狐] 最终加工原料：' + totalItems + ' 个')
        console.info('[共振之狐] 配方扫描完成。')
        console.info('[共振之狐] ========================================')
    }

    /*
     * ============================================================
     * 判断物品是否属于：
     *   Create 石磨原料
     *   或
     *   Create 粉碎轮原料
     * ============================================================
     */
    function isProcessingIngredient(itemId) {
        return crushingItems[itemId] === true
    }

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
            console.error('[共振之狐] 获取 Item 本地化名称失败：' + e)
            try {
                return Component.literal(String(item.getId()))
            } catch (e2) {
                return Component.literal('未知物品')
            }
        }
    }

    /*
     * ============================================================
     * 向玩家的共振之狐记录中添加物品
     *
     * NBT：
     * ForgeCaps."ageofmythology:traveller".nbt_resonance_fox_item
     * ============================================================
     */
    function addRecord(list, itemId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                if (list.getCompound(i).getString('item') === itemId) return false
            } catch (e) {
                console.error('[共振之狐] 读取已有记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('item', itemId)
        list.add(tag)
        return true
    }

    /*
     * ============================================================
     * 处理玩家获得的物品
     *
     * 只要获得的物品属于石磨 / 粉碎轮原料，就写入：
     *
     * ForgeCaps."ageofmythology:traveller".nbt_resonance_fox_item
     *
     * 注意：
     *   ForgeCaps 属于玩家完整 NBT，不是 PersistentData。
     *   因此这里必须使用 player.getNbt() / player.setNbt()。
     * ============================================================
     */
    function process(player, item) {
        if (item === null || item.isEmpty()) return

        var itemId = String(item.getId())
        if (!isProcessingIngredient(itemId)) return

        try {
            var playerNbt = player.getNbt()
            var forgeCaps = playerNbt.contains('ForgeCaps', 10) ? playerNbt.getCompound('ForgeCaps') : new CompoundTag()
            var traveller = forgeCaps.contains(TRAVELLER_CAP, 10) ? forgeCaps.getCompound(TRAVELLER_CAP) : new CompoundTag()
            var list = traveller.contains(RECORD_LIST, 9) ? traveller.getList(RECORD_LIST, 10) : new ListTag()

            if (!addRecord(list, itemId)) return

            traveller.put(RECORD_LIST, list)
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

            var name = getItemName(item)
            var message = Component.literal('§a[共振之狐] §7发现新的加工原料 §8» §f').append(name).append(Component.literal(' §8[' + itemId + ']'))
            player.tell(message)
        } catch (e) {
            console.error('[共振之狐] 更新玩家 ForgeCaps 失败：' + e)
        }
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
            console.error('[共振之狐] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
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
                console.error('[共振之狐] 扫描配方失败：' + e)
            }
        })
    } catch (e) {
        console.error('[共振之狐] 注册 ServerEvents.loaded 失败（配方扫描将不可用）：' + e)
    }

    /*
     * ============================================================
     * 玩家物品栏发生变化时检测获得物品
     * ============================================================
     */
    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()