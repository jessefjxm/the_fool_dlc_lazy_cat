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
 *   不使用 Ingredient.getItems()。
 *   直接解析 Create 配方 JSON，兼容 KubeJS 2001.6.5-build.16。
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var BuiltInRegistries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
    var ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
    var TagKey = Java.loadClass('net.minecraft.tags.TagKey')

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
        console.info('[共振之狐] 已记录加工原料：' + itemId + (source ? ' ← ' + source : ''))
        return true
    }

    /*
     * ============================================================
     * 展开 Minecraft Item Tag
     *
     * 例如：
     *   create:stone_types/crimsite
     *
     * 自动转换成：
     *   create:crimsite
     *   create:cut_crimsite
     *   create:crimsite_pillar
     *   ...
     *
     * 不能使用 Ingredient.getItems()，因此直接从
     * BuiltInRegistries.ITEM 获取 Tag 成员。
     * ============================================================
     */
    function expandItemTag(tagId, source) {
        try {
            if (!tagId) return 0
            tagId = String(tagId)
            var resourceLocation = ResourceLocation.parse(tagId)
            var tagKey = TagKey.create(BuiltInRegistries.ITEM.key(), resourceLocation)
            var optionalTag = BuiltInRegistries.ITEM.getTag(tagKey)
            if (optionalTag === null || !optionalTag.isPresent()) {
                console.info('[共振之狐] 找不到 Item Tag：' + tagId + ' ← ' + source)
                return 0
            }
            var holders = optionalTag.get()
            var iterator = holders.iterator()
            var newCount = 0
            while (iterator.hasNext()) {
                try {
                    var holder = iterator.next()
                    if (holder === null) continue
                    var item = holder.value()
                    if (item === null) continue
                    var itemId = String(BuiltInRegistries.ITEM.getKey(item).toString())
                    if (addProcessingItem(itemId, source + ' [tag:' + tagId + ']')) newCount++
                } catch (e) {
                    console.error('[共振之狐] 读取 Item Tag 成员失败：' + e)
                }
            }
            console.info('[共振之狐] Tag 展开完成：' + tagId + ' → 新增 ' + newCount + ' 个物品')
            return newCount
        } catch (e) {
            console.error('[共振之狐] 展开 Item Tag 失败：' + tagId + '：' + e)
            return 0
        }
    }

    /*
     * ============================================================
     * 解析 Create 配方 Ingredient
     *
     * 支持：
     *   {"item":"minecraft:cobblestone"}
     *   {"tag":"minecraft:logs"}
     *   {"items":[...]}
     *   {"ingredient":{...}}
     * ============================================================
     */
    function parseIngredientJson(ingredientJson, source) {
        if (ingredientJson === null || ingredientJson === undefined) return 0
        var count = 0
        try {
            if (ingredientJson.has('item')) {
                if (addProcessingItem(ingredientJson.get('item').getAsString(), source)) count++
                return count
            }
            if (ingredientJson.has('tag')) {
                return expandItemTag(ingredientJson.get('tag').getAsString(), source)
            }
            if (ingredientJson.has('items')) {
                var items = ingredientJson.get('items')
                if (items.isJsonArray()) for (var i = 0; i < items.size(); i++) count += parseIngredientJson(items.get(i), source)
                return count
            }
            if (ingredientJson.has('ingredient')) return parseIngredientJson(ingredientJson.get('ingredient'), source)
            console.info('[共振之狐] 未识别 Ingredient：' + ingredientJson.toString() + ' ← ' + source)
        } catch (e) {
            console.error('[共振之狐] 解析 Ingredient 失败：' + e + ' ← ' + source)
        }
        return count
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
     * ============================================================
     */
    function scanRecipes(event) {
        event.forEachRecipe({}, function (recipe) {
            try {
                var json = recipe.json
                if (json === null || json === undefined || !json.has('type')) return
                var type = String(json.get('type').getAsString())
                if (!RECIPE_TYPES[type]) return

                var recipeId = String(recipe.getId())
                if (type === 'create:milling') millingCount++
                else if (type === 'create:crushing') crushingCount++

                if (!json.has('ingredients')) return
                var ingredients = json.get('ingredients')
                if (!ingredients.isJsonArray()) return

                for (var i = 0; i < ingredients.size(); i++) {
                    ingredientCount++
                    parseIngredientJson(ingredients.get(i), recipeId)
                }
            } catch (e) {
                console.error('[共振之狐] 扫描 Recipe 失败：' + e)
            }
        })

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

        console.info('[共振之狐] ★ 发现 Create 加工原料：' + itemId)

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

            var name = getItemName(item)
            var message = Component.literal('§a[共振之狐] §7发现新的加工原料 §8» §f').append(name).append(Component.literal(' §8[' + itemId + ']'))
            player.tell(message)

            console.info('[共振之狐] 已新增记录：' + itemId)
        } catch (e) {
            console.error('[共振之狐] 更新玩家 ForgeCaps 失败：' + e)
        }
    }

    /*
     * ============================================================
     * 服务器加载配方后扫描：
     *   create:milling
     *   create:crushing
     * ============================================================
     */
    ServerEvents.recipes(function (event) {
        scanRecipes(event)
    })

    /*
     * ============================================================
     * 玩家物品栏发生变化时检测获得物品
     * ============================================================
     */
    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()