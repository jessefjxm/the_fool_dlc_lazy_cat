 /*
  * ============================================================
  * 献祭之猫 - 记录可放入 Curios skull 槽位的神话物品
  * ============================================================
  *
  * Minecraft:
  *   Forge 1.20.1
  *   KubeJS 2001.6.5-build.16
  *
  * 功能：
  *   1. 当玩家获得物品时触发检测。
  *   2. 仅处理来自 ageofmythology 模组的物品。
  *   3. 使用 Curios API 判断物品是否可以放入 skull 槽位。
  *   4. 将符合条件的物品 ID 记录到：
  *
  *      ForgeCaps."ageofmythology:traveller"
  *        .nbt_sacrifice_item
  *
  *   数据格式：
  *      [
  *        {
  *          item: "ageofmythology:xxx"
  *        }
  *      ]
  *
  *   5. 已存在的物品不会重复添加。
  *   6. 新发现物品时提示玩家。
  *
  * ============================================================
  */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var SlotContext = Java.loadClass('top.theillusivec4.curios.api.SlotContext')
    var CuriosApi = Java.loadClass('top.theillusivec4.curios.api.CuriosApi')

    var MOD_ID = 'ageofmythology'
    var SLOT_ID = 'skull'

    /*
     * ------------------------------------------------------------
     * 获取物品本地化名称
     *
     * 例如：
     *   ageofmythology:xxx
     *     -> item.ageofmythology.xxx
     *
     * 如果模组没有提供对应翻译，Minecraft 会显示
     * 未翻译的键，因此最终提示仍然可以保留完整 ID。
     * ------------------------------------------------------------
     */
    function getItemName(itemId) {
        try {
            var key = 'item.' + itemId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[献祭之猫] 获取物品本地化名称失败：' + e)
            return Component.literal(itemId)
        }
    }

    /*
     * ------------------------------------------------------------
     * 向记录列表添加一条 item 记录
     * ------------------------------------------------------------
     */
    function addRecord(list, itemId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString('item') === itemId) return false
            } catch (e) {
                console.error('[献祭之猫] 读取已有献祭物品记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('item', itemId)
        list.add(tag)
        return true
    }

    /*
     * ------------------------------------------------------------
     * 判断物品是否可以放入 Curios skull 槽位
     *
     * SlotContext:
     *   identifier = skull
     *   entity     = 当前玩家
     *   index      = -1
     * ------------------------------------------------------------
     */
    function canEquipToSkull(player, item) {
        try {
            var context = new SlotContext(SLOT_ID, player, -1, false, false)
            return CuriosApi.isStackValid(context, item)
        } catch (e) {
            console.error('[献祭之猫] 检查 skull 槽位失败：' + e)
            return false
        }
    }

    /*
     * ------------------------------------------------------------
     * 处理玩家获得的物品
     * ------------------------------------------------------------
     */
    function process(player, item) {
        if (item === null || item.isEmpty()) return

        var itemId = String(item.getId())

        /*
         * 只处理 ageofmythology 模组物品
         */
        if (itemId.indexOf(MOD_ID + ':') !== 0) return

        /*
         * 检查是否可以放入 Curios skull 槽位
         */
        if (!canEquipToSkull(player, item)) return

        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound('ageofmythology:traveller')
        var items = traveller.contains('nbt_sacrifice_item') ? traveller.getList('nbt_sacrifice_item', 10) : new ListTag()

        /*
         * 已经记录过则不重复添加
         */
        if (!addRecord(items, itemId)) return

        traveller.put('nbt_sacrifice_item', items)

        /*
         * 保存玩家 NBT
         *
         * 显式重新写回：
         *   traveller
         *     ↓
         *   ForgeCaps
         *     ↓
         *   playerNbt
         *
         * 避免 ForgeCaps 或 traveller 原本不存在时，
         * 新创建的 CompoundTag 没有真正挂回玩家 NBT。
         */
        forgeCaps.put('ageofmythology:traveller', traveller)
        playerNbt.put('ForgeCaps', forgeCaps)
        player.setNbt(playerNbt)

        /*
         * 提示玩家
         */
        var itemName = getItemName(itemId)
        var message = Component.literal('§a[献祭之猫] §7发现新的遗物 §8» §f').append(itemName).append(Component.literal(' §8[' + itemId + ']'))
        player.tell(message)
    }

    /*
     * ------------------------------------------------------------
     * 玩家获得/库存发生变化
     * ------------------------------------------------------------
     */
    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()