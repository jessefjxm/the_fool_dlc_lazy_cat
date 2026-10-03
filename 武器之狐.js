/*
 * ============================================================
 * 武器之狐 - 记录玩家获得过的装备
 * ============================================================
 *
 * Minecraft:
 *   Forge 1.20.1
 *   KubeJS 2001.6.5-build.16
 *
 * 功能：
 *   1. 玩家获得装备类型道具时自动检测。
 *   2. 支持原版：
 *      sword
 *      axe
 *      shovel
 *      pickaxe
 *      hoe
 *      bow
 *      crossbow
 *      trident
 *      helmet
 *      chestplate
 *      leggings
 *      boots
 *   3. 通过 Item 实际 Java 类型识别 Mod 武器。
 *   4. 通过 Item Tag 识别 Mod 武器。
 *   5. 通过 ATTACK_DAMAGE / ATTACK_SPEED 属性识别
 *      不继承原版 SwordItem 的特殊近战武器。
 *   6. 支持特殊远程武器 Tag。
 *   7. 支持 Goety 的 staff / wand。
 *   8. 支持 Iron's Spells 'n Spellbooks 的 spellbook。
 *   9. 对常见非标准近战武器名称进行 ID 兜底识别。
 *  10. 同一种物品只记录一次。
 *  11. 记录物品的本地化名称用于提示。
 *
 * NBT：
 *
 *   ForgeCaps."ageofmythology:traveller".nbt_has_used_weapon
 *
 * NBT 格式：
 *
 *   nbt_has_used_weapon: [{
 *       weaponName: "minecraft:diamond_sword"
 *   }, {
 *       weaponName: "simplyswords:netherite_longsword"
 *   }, {
 *       weaponName: "traveloptics:stellothorn"
 *   }]
 *
 * ============================================================
 */

(function () {
    var CompoundTag = Java.loadClass('net.minecraft.nbt.CompoundTag')
    var ListTag = Java.loadClass('net.minecraft.nbt.ListTag')
    var ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack')
    var EquipmentSlot = Java.loadClass('net.minecraft.world.entity.EquipmentSlot')
    var Attributes = Java.loadClass('net.minecraft.world.entity.ai.attributes.Attributes')

    var SwordItem = Java.loadClass('net.minecraft.world.item.SwordItem')
    var AxeItem = Java.loadClass('net.minecraft.world.item.AxeItem')
    var ShovelItem = Java.loadClass('net.minecraft.world.item.ShovelItem')
    var PickaxeItem = Java.loadClass('net.minecraft.world.item.PickaxeItem')
    var HoeItem = Java.loadClass('net.minecraft.world.item.HoeItem')
    var BowItem = Java.loadClass('net.minecraft.world.item.BowItem')
    var CrossbowItem = Java.loadClass('net.minecraft.world.item.CrossbowItem')
    var TridentItem = Java.loadClass('net.minecraft.world.item.TridentItem')
    var ArmorItem = Java.loadClass('net.minecraft.world.item.ArmorItem')

    var TRAVELLER_CAP = 'ageofmythology:traveller'
    var RECORD_LIST = 'nbt_has_used_weapon'

    /*
     * ============================================================
     * 判断 Java Item 是否属于指定类型
     *
     * 使用 Class.isInstance()，而不是 JS instanceof。
     *
     * 这样可以识别：
     *
     *   Mod 自定义 SwordItem
     *       ↓
     *   SwordItem 子类
     *       ↓
     *   自动识别
     * ============================================================
     */
    function isInstance(item, javaClass) {
        try {
            return javaClass.isInstance(item.getItem())
        } catch (e) {
            return false
        }
    }

    /*
     * ============================================================
     * 判断 Item 是否拥有指定 Tag
     *
     * 这里只检查完整 Tag ID，不使用模糊 contains。
     *
     * 这样可以避免：
     *
     *   some:staff_material
     *   some:weapon_part
     *
     * 被误判为真正武器。
     * ============================================================
     */
    function hasItemTag(item, tagList) {
        try {
            var mcItem = item.getItem()
            var holder = mcItem.builtInRegistryHolder()
            var iterator = holder.tags().iterator()

            while (iterator.hasNext()) {
                var tag = iterator.next()
                var tagId = String(tag.location()).toLowerCase()

                for (var i = 0; i < tagList.length; i++) {
                    if (tagId === tagList[i]) return true
                }
            }
        } catch (e) {
            // 某些特殊 Item 无法读取 Tag，继续执行其他识别方式。
        }

        return false
    }

    /*
     * ============================================================
     * 通过 Item 实际 Java 类型判断装备
     *
     * 这是第一优先级。
     *
     * 可以自动识别：
     *
     *   SwordItem
     *   AxeItem
     *   ShovelItem
     *   PickaxeItem
     *   HoeItem
     *   BowItem
     *   CrossbowItem
     *   TridentItem
     *   ArmorItem
     *
     * 以及这些类的 Mod 子类。
     * ============================================================
     */
    function isNativeWeaponOrArmor(item) {
        if (isInstance(item, SwordItem)) return true
        if (isInstance(item, AxeItem)) return true
        if (isInstance(item, ShovelItem)) return true
        if (isInstance(item, PickaxeItem)) return true
        if (isInstance(item, HoeItem)) return true
        if (isInstance(item, BowItem)) return true
        if (isInstance(item, CrossbowItem)) return true
        if (isInstance(item, TridentItem)) return true
        if (isInstance(item, ArmorItem)) return true
        return false
    }

    /*
     * ============================================================
     * 通过标准 Item Tag 判断装备
     *
     * 不使用：
     *   forge:tools
     *   c:tools
     *
     * 因为这些 Tag 范围过大，会包含大量普通工具。
     * ============================================================
     */
    function isTaggedWeaponOrArmor(item) {
        if (hasItemTag(item, [
            'minecraft:swords',
            'forge:swords',
            'c:swords'
        ])) return true

        if (hasItemTag(item, [
            'minecraft:axes',
            'forge:axes',
            'c:axes'
        ])) return true

        if (hasItemTag(item, [
            'minecraft:shovels',
            'forge:shovels',
            'c:shovels'
        ])) return true

        if (hasItemTag(item, [
            'minecraft:pickaxes',
            'forge:pickaxes',
            'c:pickaxes'
        ])) return true

        if (hasItemTag(item, [
            'minecraft:hoes',
            'forge:hoes',
            'c:hoes'
        ])) return true

        if (hasItemTag(item, [
            'forge:weapons',
            'forge:weapon',
            'c:weapons',
            'c:weapon'
        ])) return true

        if (hasItemTag(item, [
            'minecraft:enchantable/weapon'
        ])) return true

        if (hasItemTag(item, [
            'forge:armors',
            'forge:armor',
            'c:armors',
            'c:armor'
        ])) return true

        if (hasItemTag(item, [
            'minecraft:enchantable/armor'
        ])) return true

        return false
    }

    /*
     * ============================================================
     * 特殊武器 Tag
     *
     * 用于：
     *   Goety Staff / Wand
     *   Iron's Spellbooks Spellbook
     *   Mod 枪械 / 远程武器
     * ============================================================
     */
    function isSpecialWeaponByTag(item) {
        if (hasItemTag(item, [
            'goety:staff',
            'goety:staffs',
            'goety:wand',
            'goety:wands',
            'forge:staff',
            'forge:staffs',
            'c:staff',
            'c:staffs',
            'forge:wand',
            'forge:wands',
            'c:wand',
            'c:wands'
        ])) return true

        if (hasItemTag(item, [
            'irons_spellbooks:spellbook',
            'irons_spellbooks:spellbooks',
            'forge:spellbook',
            'forge:spellbooks',
            'c:spellbook',
            'c:spellbooks'
        ])) return true

        /*
         * 常见枪械 / 远程武器 Tag。
         *
         * 不把 projectile Tag 当作武器 Tag，
         * 避免把箭、雪球等投射物误判成武器。
         */
        if (hasItemTag(item, [
            'forge:firearms',
            'forge:firearm',
            'c:firearms',
            'c:firearm',
            'forge:ranged_weapons',
            'forge:ranged_weapon',
            'c:ranged_weapons',
            'c:ranged_weapon',
            'forge:guns',
            'forge:gun',
            'c:guns',
            'c:gun'
        ])) return true

        /*
         * Biomancy。
         *
         * 不同版本可能使用不同 Tag，因此同时兼容旧 / 新命名。
         */
        if (hasItemTag(item, [
            'biomancy:weapons',
            'biomancy:weapon',
            'biomancy:tools'
        ])) return true

        return false
    }

    /*
     * ============================================================
     * 通过攻击属性识别未知近战武器
     *
     * 这是本版最重要的新机制。
     *
     * 很多 Mod 武器：
     *
     *   不继承 SwordItem
     *   不加入标准 sword Tag
     *   ID 也完全不像 sword
     *
     * 但是它作为真正的近战武器，会拥有：
     *
     *   ATTACK_DAMAGE
     *   ATTACK_SPEED
     *
     * 因此可以通过原生 ItemStack 的属性修饰器识别。
     *
     * 示例：
     *
     *   traveloptics:stellothorn
     *   traveloptics:gauntlet_of_extinction
     *   rainbowcompound:refined_radiance_scythes
     *
     * ============================================================
     */
    function hasAttackAttributes(item) {
        try {
            var stack = new ItemStack(item.getItem())
            var modifiers = stack.getAttributeModifiers(EquipmentSlot.MAINHAND)

            if (modifiers === null || modifiers.isEmpty()) return false

            if (modifiers.containsKey(Attributes.ATTACK_DAMAGE)) return true
            if (modifiers.containsKey(Attributes.ATTACK_SPEED)) return true
        } catch (e) {
            console.error('[武器之狐] 检查攻击属性失败：' + e)
        }

        return false
    }

    /*
     * ============================================================
     * 远程武器特殊识别
     *
     * 不能简单把所有 projectile Item 当成武器，
     * 因为箭、雪球、鸡蛋等也属于投射物。
     *
     * 因此这里只处理明确的模组 / 武器关键词。
     * ============================================================
     */
    function isRangedWeaponById(itemId) {
        var path = itemId.indexOf(':') >= 0 ? itemId.substring(itemId.indexOf(':') + 1) : itemId
        var namespace = itemId.indexOf(':') >= 0 ? itemId.substring(0, itemId.indexOf(':')) : ''

        /*
         * Biomancy。
         *
         * caustic_gunblade 是典型的非标准远程武器。
         */
        if (namespace === 'biomancy' && path.indexOf('gunblade') !== -1) return true

        /*
         * 常见枪械命名。
         *
         * 只作为最后的远程武器兜底。
         */
        var rangedSuffixes = [
            'gun',
            'rifle',
            'pistol',
            'shotgun',
            'musket',
            'blaster',
            'crossbow',
            'bow',
            'launcher',
            'gunblade'
        ]

        for (var i = 0; i < rangedSuffixes.length; i++) {
            var suffix = rangedSuffixes[i]
            if (path === suffix || path.endsWith('_' + suffix)) return true
        }

        return false
    }

    /*
     * ============================================================
     * 非标准近战武器 ID 兜底识别
     *
     * 只有前面的：
     *
     *   Java 类型
     *   Tag
     *   攻击属性
     *
     * 都无法识别时才会进入这里。
     *
     * 因此这些关键词不会成为主要判断依据。
     * ============================================================
     */
    function isMeleeWeaponById(itemId) {
        var path = itemId.indexOf(':') >= 0 ? itemId.substring(itemId.indexOf(':') + 1) : itemId

        var weaponSuffixes = [
            'sword',
            'longsword',
            'greatsword',
            'lichblade',
            'blade',
            'rapier',
            'katana',
            'machete',
            'glaive',
            'halberd',
            'claymore',
            'greataxe',
            'battleaxe',
            'greatspear',
            'spear',
            'scythe',
            'scythes',
            'dagger',
            'cutlass',
            'warglaive',
            'twinblade',
            'chakram',
            'greathammer',
            'hammer',
            'flail',
            'sai',
            'falchion',
            'saber',
            'sabre'
        ]

        for (var i = 0; i < weaponSuffixes.length; i++) {
            var suffix = weaponSuffixes[i]
            if (path === suffix || path.endsWith('_' + suffix)) return true
        }

        return false
    }

    /*
     * ============================================================
     * Goety / Iron's Spellbooks ID 兜底
     * ============================================================
     */
    function isSpecialWeaponById(itemId) {
        if (itemId.indexOf('goety:') === 0) {
            var goetyPath = itemId.substring(6)
            if (goetyPath === 'staff' || goetyPath.endsWith('_staff') || goetyPath.endsWith('_wand')) return true
        }

        if (itemId.indexOf('irons_spellbooks:') === 0) {
            var spellPath = itemId.substring('irons_spellbooks:'.length)
            if (spellPath.indexOf('spellbook') !== -1 || spellPath.indexOf('spell_book') !== -1) return true
        }

        return false
    }

    /*
     * ============================================================
     * 判断是否属于装备
     *
     * 最终识别顺序：
     *
     *   ① Java Item 类型
     *   ② 标准 Item Tag
     *   ③ 特殊武器 Tag
     *   ④ 攻击属性
     *   ⑤ 特殊远程武器
     *   ⑥ 特殊 Mod ID
     *   ⑦ 非标准近战武器 ID
     *
     * 这样既能覆盖标准装备，
     * 又能覆盖大量自定义武器。
     * ============================================================
     */
    function isWeaponOrArmor(item) {
        if (item === null || item.isEmpty()) return false

        var itemId = String(item.getId()).toLowerCase()

        if (isNativeWeaponOrArmor(item)) return true
        if (isTaggedWeaponOrArmor(item)) return true
        if (isSpecialWeaponByTag(item)) return true
        if (hasAttackAttributes(item)) return true
        if (isRangedWeaponById(itemId)) return true
        if (isSpecialWeaponById(itemId)) return true
        if (isMeleeWeaponById(itemId)) return true

        return false
    }

    /*
     * ============================================================
     * 获取 Item 本地化名称
     *
     * KubeJS ItemStack
     *     ↓
     * Minecraft 原生 Item
     *     ↓
     * Item#getDescriptionId()
     *     ↓
     * Component.translatable()
     *
     * 例如：
     *
     *   minecraft:diamond_sword
     *       ↓
     *   钻石剑
     *
     *   simplyswords:netherite_longsword
     *       ↓
     *   下界合金长剑
     * ============================================================
     */
    function getItemName(item) {
        try {
            var mcItem = item.getItem()
            var translationKey = mcItem.getDescriptionId()
            return Component.translatable(translationKey)
        } catch (e) {
            console.error('[武器之狐] 获取 Item 本地化名称失败：' + e)
            return Component.literal(String(item.getId()))
        }
    }

    /*
     * ============================================================
     * 向玩家的武器之狐记录中添加物品
     *
     * 每个物品只记录一次。
     * ============================================================
     */
    function addRecord(list, itemId) {
        for (var i = 0; i < list.size(); i++) {
            try {
                if (list.getCompound(i).getString('weaponName') === itemId) return false
            } catch (e) {
                console.error('[武器之狐] 读取已有记录失败 #' + i + '：' + e)
            }
        }

        var tag = new CompoundTag()
        tag.putString('weaponName', itemId)
        list.add(tag)
        return true
    }

    /*
     * ============================================================
     * 处理玩家获得的物品
     *
     * 只要获得的物品属于装备，就写入：
     *
     *   ForgeCaps."ageofmythology:traveller".nbt_has_used_weapon
     * ============================================================
     */
    function process(player, item) {
        if (item === null || item.isEmpty()) return
        if (!isWeaponOrArmor(item)) return

        var itemId = String(item.getId())

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
            var message = Component.literal('§a[武器之狐] §7发现新的装备 §8» §f').append(name).append(Component.literal(' §8[' + itemId + ']'))

            player.tell(message)
            console.info('[武器之狐] ★ 发现新的装备：' + itemId)
        } catch (e) {
            console.error('[武器之狐] 更新玩家 ForgeCaps 失败：' + e)
        }
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