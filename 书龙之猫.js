/*
 * ============================================================
 * 书龙之猫 - 记录玩家获得的附魔书
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 检测玩家获得的 minecraft:enchanted_book。
 *   2. 读取附魔书 NBT 中的 StoredEnchantments。
 *   3. 提取每个附魔的 ID，例如：
 *        goety_revelation:reality_piercer
 *   4. 将附魔 ID 记录到：
 *        ForgeCaps."ageofmythology:traveller"
 *          .nbt_enhancement_book
 *   5. 已存在的附魔不会重复添加。
 *   6. 发现新的附魔时提示玩家。
 *
 * 附魔书 NBT 示例：
 *
 *   {
 *     name:"",
 *     type:10b,
 *     value:{
 *       Count:1b,
 *       id:"minecraft:enchanted_book",
 *       tag:{
 *         StoredEnchantments:[
 *           {
 *             id:"goety_revelation:reality_piercer",
 *             lvl:1s
 *           }
 *         ]
 *       }
 *     }
 *   }
 *
 * 玩家 NBT：
 *
 *   nbt_enhancement_book:[
 *     {
 *       desc:"goety_revelation:reality_piercer"
 *     }
 *   ]
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')

    var ENCHANTED_BOOK_ID = 'minecraft:enchanted_book'
    var STORED_ENCHANTMENTS = 'StoredEnchantments'
    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_enhancement_book'

    /*
     * ============================================================
     * 获取附魔本地化名称
     *
     * 例如：
     *
     *   minecraft:sharpness
     *     -> enchantment.minecraft.sharpness
     *
     *   goety_revelation:reality_piercer
     *     -> enchantment.goety_revelation.reality_piercer
     *
     * 如果没有对应翻译，Minecraft 会显示原始翻译键，
     * 同时后面的完整 ID 仍然会保留，方便确认具体附魔。
     * ============================================================
     */
    function getEnchantmentName(enchantmentId) {
        try {
            var key = 'enchantment.' + enchantmentId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[书龙之猫] 获取附魔本地化名称失败：' + e)
            return Component.literal(enchantmentId)
        }
    }

    /*
     * ============================================================
     * 向记录列表中添加一个附魔 ID
     *
     * 返回：
     *   true  = 成功新增
     *   false = 已经存在
     * ============================================================
     */
    function addRecord(list, enchantmentId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('desc') === enchantmentId) return false
            } catch (e) {
                console.error('[书龙之猫] 读取已有记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('desc', enchantmentId)
        list.add(tag)

        return true
    }

    /*
     * ============================================================
     * 从附魔书中读取 StoredEnchantments
     *
     * 返回：
     *   JavaScript 数组
     *
     * 例如：
     *   [
     *     'goety_revelation:reality_piercer'
     *   ]
     * ============================================================
     */
    function getEnchantmentIds(item) {
        var result = []

        try {
            var nbt = item.getNbt()
            if (nbt === null) return result

            /*
             * 物品 NBT：
             *
             * {
             *   StoredEnchantments:[
             *     {id:"xxx",lvl:1s}
             *   ]
             * }
             *
             * KubeJS ItemStack.getNbt() 返回物品自身 NBT，
             * 因此这里直接读取 StoredEnchantments。
             */
            if (!nbt.contains(STORED_ENCHANTMENTS)) return result

            var enchantments = nbt.getList(STORED_ENCHANTMENTS, 10)
            if (enchantments === null || enchantments.size() === 0) return result

            for (var i = 0; i < enchantments.size(); i++) {
                try {
                    var enchantment = enchantments.getCompound(i)
                    var id = String(enchantment.getString('id'))

                    if (id.length > 0) result.push(id)
                } catch (e) {
                    console.error('[书龙之猫] 读取附魔 #' + i + ' 失败：' + e)
                }
            }
        } catch (e) {
            console.error('[书龙之猫] 读取附魔书失败：' + e)
        }

        return result
    }

    /*
     * ============================================================
     * 处理玩家获得的物品
     * ============================================================
     */
    function process(player, item) {
        if (item === null || item.isEmpty()) return

        /*
         * 只处理原版附魔书。
         */
        if (item.getId() !== ENCHANTED_BOOK_ID) return

        var enchantmentIds = getEnchantmentIds(item)
        if (enchantmentIds.length === 0) return

        /*
         * ========================================================
         * 获取玩家 Traveller Capability NBT
         * ========================================================
         */
        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound(TRAVELLER_CAP)

        /*
         * 获取已有记录。
         */
        var books = traveller.contains(RECORD_LIST) ? traveller.getList(RECORD_LIST, 10) : new ListTag()
        var changed = false

        /*
         * ========================================================
         * 逐个记录附魔
         *
         * 一张附魔书可能包含多个附魔，因此不能只读取一个。
         * ========================================================
         */
        for (var i = 0; i < enchantmentIds.length; i++) {
            var enchantmentId = enchantmentIds[i]

            if (!addRecord(books, enchantmentId)) continue

            changed = true

            /*
             * 提示玩家：
             *   §a  [书龙之猫]
             *   §7  普通提示文字
             *   §8  分隔符 / ID
             *   §f  附魔本地化名称
             */
            var enchantmentName = getEnchantmentName(enchantmentId)
            var message = Component.literal('§a[书龙之猫] §7发现新的附魔 §8» §f').append(enchantmentName).append(Component.literal(' §8[' + enchantmentId + ']'))
            player.tell(message)

            console.info('[书龙之猫] 已记录新附魔：' + enchantmentId)
        }

        /*
         * ========================================================
         * 保存玩家 NBT
         *
         * 显式写回：
         *   books
         *     ↓
         *   traveller
         *     ↓
         *   ForgeCaps
         *     ↓
         *   playerNbt
         *
         * 避免 ForgeCaps 或 traveller 原本不存在时，
         * 新创建的 CompoundTag 没有真正挂回父节点。
         * ========================================================
         */
        if (changed) {
            traveller.put(RECORD_LIST, books)
            forgeCaps.put(TRAVELLER_CAP, traveller)
            playerNbt.put('ForgeCaps', forgeCaps)
            player.setNbt(playerNbt)
        }
    }

    /*
     * ============================================================
     * 玩家物品栏发生变化时检测
     * ============================================================
     */
    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()