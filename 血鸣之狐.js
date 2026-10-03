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
    var Ingredient = Java.loadClass('net.minecraft.world.item.crafting.Ingredient')

    var CAMPFIRE_TYPE = 'minecraft:campfire_cooking'
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_blood_fox_item'

    /*
     * 保存所有营火配方的 Ingredient。
     *
     * 不直接保存 item ID，而是保存 Minecraft 原生 Ingredient。
     * 这样可以自动处理：
     *
     *   {"item":"minecraft:beef"}
     *
     *   {"tag":"forge:raw_meat"}
     *
     * 等 Ingredient。
     */
    var campfireIngredients = []

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
     * ============================================================
     */
    function scanRecipes(event) {
        console.info('[血鸣之狐] 开始扫描全部配方，寻找营火配方。')

        var recipeCount = 0
        var campfireCount = 0
        var ingredientCount = 0

        event.forEachRecipe({}, function (recipe) {
            try {
                recipeCount++

                var json = recipe.json
                if (json === null || json === undefined || !json.has('type')) return

                var type = String(json.get('type').getAsString())
                if (type !== CAMPFIRE_TYPE) return

                campfireCount++

                var recipeId = String(recipe.getId())
                console.info('[血鸣之狐] 找到营火配方：' + recipeId)

                /*
                 * 营火配方的原料字段为：
                 *
                 *   "ingredient": {...}
                 *
                 * 某些配方也可能使用 Ingredient 数组，
                 * 因此这里同时兼容：
                 *
                 *   {"item": "..."}
                 *
                 * 和：
                 *
                 *   [
                 *     {"item": "..."},
                 *     {"tag": "..."}
                 *   ]
                 */
                if (!json.has('ingredient')) {
                    console.info('[血鸣之狐] 营火配方没有 ingredient：' + recipeId)
                    return
                }

                var ingredientJson = json.get('ingredient')

                /*
                 * ========================================================
                 * 单个 Ingredient
                 * ========================================================
                 */
                if (ingredientJson.isJsonObject()) {
                    try {
                        var ingredient = Ingredient.fromJson(ingredientJson)

                        if (ingredient !== null) {
                            campfireIngredients.push(ingredient)
                            ingredientCount++
                            console.info('[血鸣之狐] 已记录营火 Ingredient：' + ingredientJson.toString())
                        }
                    } catch (e) {
                        console.error('[血鸣之狐] 解析营火 Ingredient 失败：' + e)
                    }

                    return
                }

                /*
                 * ========================================================
                 * Ingredient 数组
                 * ========================================================
                 */
                if (ingredientJson.isJsonArray()) {
                    for (var i = 0; i < ingredientJson.size(); i++) {
                        try {
                            var entry = ingredientJson.get(i)
                            var ingredient2 = Ingredient.fromJson(entry)

                            if (ingredient2 !== null) {
                                campfireIngredients.push(ingredient2)
                                ingredientCount++
                                console.info('[血鸣之狐] 已记录营火 Ingredient：' + entry.toString())
                            }
                        } catch (e2) {
                            console.error('[血鸣之狐] 解析营火 Ingredient #' + i + ' 失败：' + e2)
                        }
                    }
                }
            } catch (e) {
                console.error('[血鸣之狐] 扫描营火配方失败：' + e)
            }
        })

        console.info('[血鸣之狐] 全部配方扫描完成：' + recipeCount + ' 个。')
        console.info('[血鸣之狐] 找到营火配方：' + campfireCount + ' 个。')
        console.info('[血鸣之狐] 找到营火 Ingredient：' + ingredientCount + ' 个。')
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
         * 提示玩家发现新的营火原料。
         */
        var itemName = getItemName(item)
        var message = Component.literal('§a[血鸣之狐] §7发现新的营火原料 §8» §f').append(itemName).append(Component.literal(' §8[' + itemId + ']'))
        player.tell(message)

        console.info('[血鸣之狐] 已记录营火原料：' + itemId)
    }

    /*
     * ============================================================
     * 注册事件
     * ============================================================
     */

    ServerEvents.recipes(function (event) {
        scanRecipes(event)
    })

    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()