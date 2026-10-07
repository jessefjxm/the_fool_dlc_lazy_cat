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

    /*
     * 模组 capability 入口，用于把记录同步给客户端 UI。
     * 放在运行时解析：加载期任何 loadClass 抛错都会让 KubeJS
     * 丢弃整份脚本，所以统一用 loadClass 包一层。
     */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[献祭之猫] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    var MOD_ID = 'ageofmythology'
    var SLOT_ID = 'skull'

    /*
     * 收集进度的「上限」：本整合包内能收集到的记录总数，
     * 来源是模组手册该页的候选集合 —— ManualCatalogFactory
     * 把 ForgeRegistries.ITEMS 里 hasTag(ageofmythology:curios/skull)
     * 的物品全部列出来，实测 951。
     * 模组增删条目时改这里即可（可用 图鉴上限_查询.js 复核）。
     */
    var MAX_COUNT = 951


    /*
     * 组装进度标记，两档：当前 / 上限
     *   §8(§a261§7/§f951§8)
     * 当前亮绿=已记录遗物条数，上限白色=整合包内可收集的总数。
     *
     * 注意：CatOfSacrificeItem.bonus_count（12）虽然存在，
     * 但它是「佩戴超过 12 个遗物时加成翻倍」的机制阈值，
     * 与收集数量不是同一个维度，因此不在提示里显示中间档。
     */
    function progressText(collected, max) {
        return ' §8(§a' + collected + '§7/§f' + max + '§8)'
    }

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
     * 悬停提示
     *
     * 实现放在 _悬停.js（global.hover），因为它要自己 new 原生
     * ItemStack / ItemStackInfo 才能绕过 KubeJS 对 HoverEvent 官方
     * API 的屏蔽，13 个脚本没必要各抄一份。
     * 那种"绕"的原因与实测记录都写在 _悬停.js 的头部注释里。
     * ------------------------------------------------------------
     */
    function hoverItem(component, itemId, nbt) {
        try {
            return global.hover.hoverItem(component, itemId, nbt)
        } catch (e) {
            console.error('[献祭之猫] 悬停工具不可用：' + e)
            return component
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
         * 把新记录同步给客户端，让 UI 立即刷新
         */
        syncCapability(player)

        /*
         * 提示玩家（末尾括号是收集进度）
         *
         * 悬停只挂在两处，其余部分必须无悬停：
         *   §a[献祭之猫]  -> 本脚本对应的道具（献祭之猫）
         *   <遗物的中文名> -> 本次记录的遗物
         * 中间的说明文字、末尾的 [id] 与进度括号都保持干净。
         *
         * 注意：绝不能写成先给前缀挂悬停、再 prefix.append(...) ——
         * MutableComponent.append 是原地修改，会让整条消息都继承
         * 那个悬停（曾出现：中间文字和进度括号都弹出道具信息）。
         * 所以基底永远是一个全新的 literal，悬停只贴在对应片段上。
         */
        var message = Component.literal('')
            .append(hoverItem(Component.literal('§a[献祭之猫]'), SCRIPT_ITEMS['献祭之猫'], null))
            .append(Component.literal(' §7发现新的遗物 §8» §f'))
            .append(hoverItem(getItemName(itemId), itemId, null))
            .append(Component.literal(' §8[' + itemId + ']'))
            .append(Component.literal(progressText(items.size(), MAX_COUNT)))
        player.tell(message)
    }

    /*
     * ============================================================
     * 每个「xx之x」脚本对应的本体道具（脚本名 = 道具名）
     *
     * 用于给提示前缀 [xx之x] 挂上该道具的 show_item 悬停。
     * id 全部来自模组语言文件 assets/ageofmythology/lang/zh_cn.json
     * 里 "item.ageofmythology.<id>": "<中文名>" 的对应关系，不是猜的：
     *   献祭之猫     -> ageofmythology_cat_of_sacrifice_item
     *   大魔法师遗物 -> ageofmythology_grand_mage_item
     *   旅者核心     -> ageofmythology_travel_core_item
     *   孤独症：聆听 -> ageofmythology_autism_listen_item
     *
     * 本脚本用到的是「献祭之猫」那一条；整表保留，
     * 方便其它脚本照抄同一份对应关系。
     * ============================================================
     */
    var SCRIPT_ITEMS = {
        '献祭之猫': 'ageofmythology:ageofmythology_cat_of_sacrifice_item',
        '拾魔之猫': 'ageofmythology:ageofmythology_cat_of_mana_pick_item',
        '书龙之猫': 'ageofmythology:ageofmythology_cat_of_dragon_book_item',
        '坚韧之猫': 'ageofmythology:ageofmythology_cat_of_tenacity_item',
        '酿态之猫': 'ageofmythology:ageofmythology_cat_of_brewing_item',
        '元素之猫': 'ageofmythology:ageofmythology_cat_of_elements_item',
        '贪食之狐': 'ageofmythology:ageofmythology_fox_of_gluttony_item',
        '血鸣之狐': 'ageofmythology:ageofmythology_fox_of_blood_echo_item',
        '共振之狐': 'ageofmythology:ageofmythology_fox_of_resonance_item',
        '探险之狐': 'ageofmythology:ageofmythology_fox_of_exploration_item',
        '陪伴之狐': 'ageofmythology:ageofmythology_fox_of_companion_item',
        '武器之狐': 'ageofmythology:ageofmythology_fox_of_weapon_item',
        '魔法师': 'ageofmythology:ageofmythology_grand_mage_item',
        '旅行者': 'ageofmythology:ageofmythology_travel_core_item',
        '孤独症': 'ageofmythology:ageofmythology_autism_listen_item'
    }

    /*
     * ------------------------------------------------------------
     * 把 capability 同步给客户端
     *
     * 为什么需要：
     *   模组的 UI / 属性只在它自己的 tick 与 sync 时机读内存态，
     *   而内存态里对应的记录只在 deserializeNBT 时才跟着 NBT 更新，
     *   所以纯 NBT 写入之后客户端数据包仍是旧的，
     *   表现就是道具说明文本不刷新。
     *
     * 时机：
     *   必须放在 player.setNbt(...) 之后 —— setNbt 会触发
     *   deserializeNBT，把 NBT 灌回内存态，此时 sync 才有内容可发。
     * ------------------------------------------------------------
     */
    function syncCapability(player) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data !== null) data.sync(player)
        } catch (e) {
            console.error('[献祭之猫] 同步 capability 失败（NBT 已写入，功能不受影响）：' + e)
        }
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
