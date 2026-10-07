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

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[拾魔之猫] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var SCROLL_ID = 'irons_spellbooks:scroll'
    var SPELL_CONTAINER = 'irons_spellbooks:spell_container'
    var ORB_TAG = 'irons_spellbooks:upgrade_orb_type'

    /*
     * 收集进度的「目标」：直接采用模组自己的成就阈值，不自己造数字。
     *   CatOfManaItem.getUpgradeOrbCount(player) >= 12
     *   CatOfManaItem.getScrollCount(player)   >= 128
     * 本脚本有两个不同类别，所以各自用自己的阈值。
     */
    var GOAL_ORB = 12
    var GOAL_SCROLL = 128

    /*
     * 收集进度的「上限」：本整合包内能收集到的记录总数，
     * 来源是模组手册对应页的候选集合（可用 图鉴上限_查询.js 复核）：
     *   升级法球 = ForgeRegistries.ITEMS 里 instanceof UpgradeOrbItem = 14
     *   法术卷轴 = irons_spellbooks SpellRegistry.getEnabledSpells() = 198
     */
    var MAX_ORB = 14
    var MAX_SCROLL = 198

    /*
     * --------------------------------------------------------
     * 悬停提示
     *
     * 实现放在 _悬停.js（global.hover）。
     * 前缀 [拾魔之猫] 挂它自己的道具，条目名称挂对应物品。
     * --------------------------------------------------------
     */
    function hoverItem(component, itemId, nbt) {
        try {
            return global.hover.hoverItem(component, itemId, nbt)
        } catch (e) {
            console.error('[拾魔之猫] 悬停工具不可用：' + e)
            return component
        }
    }

    /*
     * 本脚本对应的本体道具（脚本名 = 道具名）。
     * id 取自模组语言文件里 "item.ageofmythology.<id>": "拾魔之猫"。
     */
    var SCRIPT_ITEMS = {
        '拾魔之猫': 'ageofmythology:ageofmythology_cat_of_mana_pick_item'
    }

    /*
     * ------------------------------------------------------------
     * 法术卷轴的悬停
     *
     * 卷轴本身是物品 irons_spellbooks:scroll，
     * 具体记录的法术放在它的 NBT 里：
     *   irons_spellbooks:spell_container = {
     *     data: [ { id: "<法术id>", index: 0, level: 1, locked: 1b } ],
     *     maxSpells: 1, mustEquip: 0b, spellWheel: 0b
     *   }
     * （字段名对照 irons_spellbooks 的 ISpellContainer.NBT /
     *   SpellContainer.SPELL_DATA 等常量，不是猜的。）
     *
     * 这样鼠标移到法术名称上时，弹出的就是"装着这个法术的卷轴"卡片。
     * NBT 拼装失败时退化为只有物品图标的卷轴，不影响提示文字。
     * ------------------------------------------------------------
     */
    function scrollHover(component, spellId) {
        var snbt = '{Count:1b,id:"irons_spellbooks:scroll",tag:{"irons_spellbooks:spell_container":{data:[{id:"' +
            String(spellId) + '",index:0,level:1,locked:1b}],maxSpells:1,mustEquip:0b,spellWheel:0b}}}'
        try {
            return global.hover.hoverItemWithSnbt(component, 'irons_spellbooks:scroll', snbt)
        } catch (e) {
            console.error('[拾魔之猫] 卷轴悬停失败：' + e)
            return component
        }
    }

    /*
     * 组装进度标记，三档：当前 / 目标 / 上限
     *   §8(§a261§7/§e12§7/§f951§8)
     * 括号深灰弱化；当前亮绿、目标亮金（模组成就阈值）、上限白色（整合包理论上限）。
     */
    function progressText(collected, goal, max) {
        return ' §8(§a' + collected + '§7/§e' + goal + '§7/§f' + max + '§8)'
    }

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
         * 提示前缀，挂【拾魔之猫】本体道具的悬停。
         * 放在分支外，两个分支共用同一份。
         */
        var prefix = hoverItem(Component.literal('§a[拾魔之猫]'), SCRIPT_ITEMS['拾魔之猫'], null)

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
                /*
                 * 法术名称挂【装着该法术的卷轴】：卡片里能看到法术名与等级。
                 */
                var message = Component.literal('')
                    .append(prefix)
                    .append(Component.literal(' §7发现新的法术 §8» §f'))
                    .append(scrollHover(spellName, spellId))
                    .append(Component.literal(' §8[' + spellId + ']'))
                    .append(Component.literal(progressText(spells.size(), GOAL_SCROLL, MAX_SCROLL)))
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
                var message = Component.literal('')
                    .append(prefix)
                    .append(Component.literal(' §7发现新的升级法球 §8» §f'))
                    .append(hoverItem(itemName, itemId, null))
                    .append(Component.literal(' §8[' + itemId + ']'))
                    .append(Component.literal(progressText(orbs.size(), GOAL_ORB, MAX_ORB)))
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

            /*
             * 把新记录同步给客户端，让 UI 立即刷新。
             *
             * 必须放在 setNbt 之后：setNbt 会触发 deserializeNBT，
             * 把 NBT 灌回内存态，此时 sync 才有内容可发。
             */
            syncCapability(player)
        }
    }

    /*
     * --------------------------------------------------------
     * 把 capability 同步给客户端
     *
     * 模组的 UI / 属性只读内存态，且只在自身 tick 与 sync
     * 时机刷新；纯 NBT 写入后客户端数据包仍是旧的。
     * --------------------------------------------------------
     */
    function syncCapability(player) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data !== null) data.sync(player)
        } catch (e) {
            console.error('[拾魔之猫] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
    }

    PlayerEvents.inventoryChanged(function (event) {
        process(event.getPlayer(), event.getItem())
    })
})()