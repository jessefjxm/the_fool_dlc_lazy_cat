/*
 * ============================================================
 * 拾魔之猫 - 记录玩家获得的法术卷轴与升级法球
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 获取 irons_spellbooks:scroll 时读取其中的法术 ID。
 *   2. 将法术 ID 记录到：
 *        ForgeCaps."ageofmythology:traveller"
 *          .nbt_spell_scroll
 *   3. 获取包含 irons_spellbooks:upgrade_orb_type 的物品时，
 *      将物品 ID 记录到：
 *        ForgeCaps."ageofmythology:traveller"
 *          .nbt_upgrade_orb
 *   4. 已存在记录不会重复添加。
 *   5. 新增记录时提示玩家。
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')

    var SCROLL_ID = 'irons_spellbooks:scroll'
    var SPELL_CONTAINER = 'irons_spellbooks:spell_container'
    var ORB_TAG = 'irons_spellbooks:upgrade_orb_type'

    /*
     * --------------------------------------------------------
     * 获取 ID 的本地化名称
     *
     * item ID：
     *   minecraft:diamond
     *     -> item.minecraft.diamond
     *
     * spell ID：
     *   irons_spellbooks:fireball
     *     -> spell.irons_spellbooks.fireball
     *
     * 如果没有对应翻译，Minecraft 会显示原始翻译键，
     * 因此这里检测翻译是否存在，失败时直接显示 ID。
     * --------------------------------------------------------
     */
    function getItemName(itemId) {
        try {
            var key = 'item.' + itemId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[拾魔之猫] 获取物品本地化名称失败：' + e)
            return Component.literal(itemId)
        }
    }

    function getSpellName(spellId) {
        try {
            var key = 'spell.' + spellId.replace(':', '.')
            return Component.translatable(key)
        } catch (e) {
            console.error('[拾魔之猫] 获取法术本地化名称失败：' + e)
            return Component.literal(spellId)
        }
    }

    /*
     * --------------------------------------------------------
     * 向 ListTag 添加记录
     *
     * key：
     *   desc  -> 法术 ID
     *   item  -> 物品 ID
     *
     * 返回：
     *   true  -> 新增成功
     *   false -> 已存在
     * --------------------------------------------------------
     */
    function addRecord(list, key, value) {
        for (var i = 0; i < list.size(); i++) {
            try {
                var record = list.getCompound(i)
                if (record.getString(key) === value) return false
            } catch (e) {
                console.error('[拾魔之猫] 读取已有记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString(key, value)
        list.add(tag)
        return true
    }

    /*
     * --------------------------------------------------------
     * 获取法术卷轴中的法术 ID
     *
     * NBT：
     *   irons_spellbooks:spell_container
     *     data[0].id
     * --------------------------------------------------------
     */
    function getSpellId(item) {
        try {
            var nbt = item.getNbt()
            if (nbt === null || !nbt.contains(SPELL_CONTAINER)) return null

            var container = nbt.getCompound(SPELL_CONTAINER)
            var data = container.getList('data', 10)
            if (data === null || data.size() === 0) return null

            var spellId = String(data.getCompound(0).getString('id'))
            return spellId.length > 0 ? spellId : null
        } catch (e) {
            console.error('[拾魔之猫] 读取卷轴失败：' + e)
            return null
        }
    }

    function process(player, item) {
        if (item === null || item.isEmpty()) return

        var itemId = item.getId()
        var spellId = itemId === SCROLL_ID ? getSpellId(item) : null
        var itemNbt = item.getNbt()
        var isOrb = itemNbt !== null && itemNbt.contains(ORB_TAG)

        if (spellId === null && !isOrb) return

        var playerNbt = player.getNbt()
        var forgeCaps = playerNbt.getCompound('ForgeCaps')
        var traveller = forgeCaps.getCompound('ageofmythology:traveller')
        var changed = false

        /*
         * --------------------------------------------------------
         * 法术卷轴
         * --------------------------------------------------------
         */
        if (spellId !== null) {
            var spells = traveller.contains('nbt_spell_scroll') ? traveller.getList('nbt_spell_scroll', 10) : new ListTag()

            if (addRecord(spells, 'desc', spellId)) {
                traveller.put('nbt_spell_scroll', spells)

                var spellName = getSpellName(spellId)
                var message = Component.literal('§a[拾魔之猫] §7发现新的法术 §8» §f').append(spellName).append(Component.literal(' §8[' + spellId + ']'))
                player.tell(message)

                changed = true
            }
        }

        /*
         * --------------------------------------------------------
         * 升级法球
         * --------------------------------------------------------
         */
        if (isOrb) {
            var orbs = traveller.contains('nbt_upgrade_orb') ? traveller.getList('nbt_upgrade_orb', 10) : new ListTag()

            if (addRecord(orbs, 'item', itemId)) {
                traveller.put('nbt_upgrade_orb', orbs)

                var itemName = getItemName(itemId)
                var message = Component.literal('§a[拾魔之猫] §7发现新的升级法球 §8» §f').append(itemName).append(Component.literal(' §8[' + itemId + ']'))
                player.tell(message)

                changed = true
            }
        }

        /*
         * --------------------------------------------------------
         * 保存 NBT
         *
         * 显式重新写回：
         *   traveller
         *     ↓
         *   ForgeCaps
         *     ↓
         *   playerNbt
         *
         * 这样即使 ForgeCaps 或 traveller 原本不存在，
         * 新创建的 CompoundTag 也不会因为没有重新 put()
         * 而停留在临时对象中。
         * --------------------------------------------------------
         */
        if (changed) {
            forgeCaps.put('ageofmythology:traveller', traveller)
            playerNbt.put('ForgeCaps', forgeCaps)
            player.setNbt(playerNbt)
        }
    }

    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()