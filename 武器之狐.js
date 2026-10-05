/*
 * ============================================================
 * 武器之狐 - 记录玩家获得过的装备（ageofmythology 源码对齐版）
 * ============================================================
 *
 * Minecraft : Forge 1.20.1
 * KubeJS    : 2001.6.5-build.16
 * 模组      : ageofmythology-0.3.0-all.jar
 *
 * ------------------------------------------------------------
 * 一、判定规则：不再自己模拟，直接问模组
 * ------------------------------------------------------------
 *
 * 模组的判定入口是：
 *
 *     com.kurome.ageofmythology.utils.WeaponMasterUtil#getTargetType(Item)
 *
 * 它遍历 com.kurome.ageofmythology.utils.WeaponMasterUtil$WeaponType
 * 枚举，用 Class.isInstance 逐个匹配。枚举全部成员即模组认可的
 * 全部装备类型：
 *
 *   顺序  WeaponType             判定类                                        技能类型
 *   ----  ---------------------  --------------------------------------------  --------------
 *     1   SwordItem              net.minecraft.world.item.SwordItem            KILL
 *     2   AxeItem                net.minecraft.world.item.AxeItem              WOOD_CUTTING
 *     3   HoeItem                net.minecraft.world.item.HoeItem              TILLING
 *     4   PickaxeItem            net.minecraft.world.item.PickaxeItem          DIG
 *     5   ShovelItem             net.minecraft.world.item.ShovelItem           SHOVELING
 *     6   ArmorItem              net.minecraft.world.item.ArmorItem            GET_HURT
 *     7   ProjectileWeaponItem   net.minecraft.world.item.ProjectileWeaponItem KILL
 *     8   IWand                  com.Polarice3.Goety.api.items.magic.IWand     KILL
 *     9   ISpellbook             io.redspace.ironsspellbooks.api.item.ISpellbook KILL
 *
 * 所以本脚本只需要调用 getTargetType：
 *
 *     返回非 null  -> 是装备（顺便拿到"剑 / 斧 / 远程武器 / 魔杖 …"类型）
 *     返回 null    -> 不是装备
 *
 * 覆盖范围自然包括：原版剑斧锄镐锹、全部盔甲、弓与弩
 * （BowItem / CrossbowItem 都是 ProjectileWeaponItem 的子类）、
 * Goety 魔杖、Iron's Spells 法术书，以及所有模组自写子类。
 * 模组以后增删类型，本脚本一个字都不用改。
 *
 * ------------------------------------------------------------
 * 二、相比旧版"拼凑模拟规则"删掉的东西（旧版属于过度识别）
 * ------------------------------------------------------------
 *
 *   1. 原版三叉戟 TridentItem 在 1.20.1 里是
 *      "extends Item implements Vanishable"，不是 ProjectileWeaponItem，
 *      模组本来就不把它算作武器 —— 现在也不再记录。
 *   2. 删除 forge:weapons / c:weapons / minecraft:enchantable/weapon
 *      之类的 Tag 猜测。
 *   3. 删除 ATTACK_DAMAGE / ATTACK_SPEED 属性猜测，
 *      它会连盾牌、部分工具、非武器物品一起收进来。
 *   4. 删除 _sword / _staff / _gun / _spellbook 之类的 ID 关键字猜测。
 *
 * 顺带一提：旧版靠这些宽松规则多收进来的物品，会被
 * 武器之狐的 getBonusCount（= 已记录装备条数）算进属性加成里，
 * 换成源码规则后这个数字才和模组一致。
 *
 * ------------------------------------------------------------
 * 三、写入方式：同样交给模组
 * ------------------------------------------------------------
 *
 *     WeaponMasterUtil#hasUsedWeapon(Player, Item)   查重
 *     WeaponMasterUtil#addUsedWeapon(Player, Item)   写 capability + 同步客户端
 *
 * 落库位置（模组自己决定，与手写 NBT 完全一致）：
 *
 *     ForgeCaps."ageofmythology:traveller".nbt_has_used_weapon
 *     [ { weaponName: "minecraft:diamond_sword" }, ... ]
 *
 * 好处：
 *   - capability 内存态 / 存档 / 客户端同步三处永远一致；
 *   - 不需要自己拼 CompoundTag，也不会因为格式漂移而丢记录；
 *   - 不需要再手动调 syncCapability。
 *
 * ------------------------------------------------------------
 * 四、额外补充：夜鸦"特殊武器"
 * ------------------------------------------------------------
 *
 * 模组在 LivingDeathEvent 里还有第二条独立路径，会把
 * WeaponMasterUtil#getSpecialList() 里的物品（灾变等特殊武器，
 * 图鉴里的"特殊武器"页签）也写进同一张表。
 * 本脚本默认一起收录（INCLUDE_SPECIAL = true）。
 *
 * ------------------------------------------------------------
 * 五、关于 WEAPON_BLACKLIST
 * ------------------------------------------------------------
 *
 * WeaponMasterUtil.WEAPON_BLACKLIST 只被图鉴列表
 * （getWeaponListWrapper / getSwordList / ...）用来过滤界面显示，
 * 真正的记录路径 WeaponMasterEvents#addUsedWeapon 并不检查它。
 * 要和源码完全一致就保持 USE_BLACKLIST = false。
 *
 * ------------------------------------------------------------
 * 六、已知取舍
 * ------------------------------------------------------------
 *
 * 模组原本是"用某种武器击杀 / 挖掘 / 锄地 / 去皮 / 受伤"时
 * 按 getWeaponMasterSkillChance 的概率记录；本脚本按需求改成
 * "拿到装备就记录"（100% 命中）。触发方式不同，但判定规则与
 * 写入位置与源码完全一致。
 *
 * 另外法术书 / 魔杖常常直接进 Curios 饰品栏，
 * inventoryChanged 未必触发；走到手上用一次再由模组自身记录、
 * 或者后续补一个定时扫描 Curios 的逻辑都可以。
 *
 * 还有一类"模组自己写基类、不继承原版武器类"的武器，源码不认：
 *
 *   - traveloptics 的长矛    GeoSpearItem    -> Item
 *   - traveloptics 的法杖    GeoStaffItem    -> iron's StaffItem -> CastingItem -> Item
 *   - iron's 自家的法杖      StaffItem       -> CastingItem -> Item
 *   - 灾变的 Ancient_Spear   Item            （靠 getSpecialList 兜住）
 *
 * 前三种想要的话写进下面的 EXTRA_WEAPON_IDS 手动补录即可。
 *
 * ============================================================
 */

(function () {
    /* ============================================================
     * 工具
     * ============================================================ */

    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[武器之狐] 加载类失败：' + name + '（' + e + '）')
            return null
        }
    }

    /* ============================================================
     * ① 模组判定入口：唯一权威来源
     * ============================================================ */

    var WeaponMasterUtil = loadClass('com.kurome.ageofmythology.utils.WeaponMasterUtil')
    var ServerPlayer = loadClass('net.minecraft.server.level.ServerPlayer')

    if (WeaponMasterUtil === null) {
        console.error('[武器之狐] 未能加载 WeaponMasterUtil，脚本不会记录任何装备')
    }

    /* ============================================================
     * ② 开关
     * ============================================================ */

    // 是否收录夜鸦"特殊武器"（图鉴的特殊武器页签）
    var INCLUDE_SPECIAL = true

    // 是否套用 WEAPON_BLACKLIST
    // 源码里它只管图鉴显示，不管记录 -> 默认 false
    var USE_BLACKLIST = false

    // 是否给玩家发提示
    var ANNOUNCE = true

    // 是否写日志
    var LOG = true

    /*
     * 源码判定之外的手动补录白名单（物品 ID）。
     *
     * 源码 getTargetType 只认 WeaponType 那 9 个类，所以"模组自己写基类、
     * 不继承原版武器类、也没实现 IWand / ISpellbook"的武器不会被记录。
     * 本整合包里真实存在的例子：
     *
     *   traveloptics 的法杖 -> GeoStaffItem -> iron's StaffItem
     *                        -> CastingItem -> Item      （不是 IWand）
     *   traveloptics 的长矛 -> GeoSpearItem  -> Item      （不是 SwordItem）
     *   iron's 自家法杖     -> StaffItem     -> CastingItem -> Item
     *
     * 注意：Goety 的魔杖（IWand）和 iron's 的法术书（ISpellbook）
     * 源码本来就算武器，不需要写进这里。
     *
     * 想补就写进这里，保持空数组 = 与源码完全一致。例：
     *
     *   var EXTRA_WEAPON_IDS = [
     *       'traveloptics:staff_of_the_storm_empress',
     *       'traveloptics:wand_of_final_light'
     *   ]
     */
    var EXTRA_WEAPON_IDS = []

    var EXTRA_ID_SET = (function () {
        var set = {}

        for (var i = 0; i < EXTRA_WEAPON_IDS.length; i++) {
            set[String(EXTRA_WEAPON_IDS[i]).toLowerCase()] = true
        }

        return set
    })()

    /* ============================================================
     * ③ 懒加载缓存
     *
     * getSpecialList() / WEAPON_BLACKLIST.get() 只需要读一次，
     * 避免每次拾取都重建集合。
     * ============================================================ */

    var specialItems = null
    var specialLoaded = false

    function getSpecialItems() {
        if (!specialLoaded) {
            specialLoaded = true

            if (WeaponMasterUtil !== null) {
                try {
                    specialItems = WeaponMasterUtil.getSpecialList()
                } catch (e) {
                    console.error('[武器之狐] 读取夜鸦特殊武器列表失败，已跳过该项：' + e)
                    specialItems = null
                }
            }
        }

        return specialItems
    }

    function isSpecialItem(item) {
        var list = getSpecialItems()
        if (list === null) return false

        try {
            return list.contains(item)
        } catch (e) {
            return false
        }
    }

    var blacklistItems = null
    var blacklistLoaded = false

    function isBlacklisted(item) {
        if (!blacklistLoaded) {
            blacklistLoaded = true

            if (WeaponMasterUtil !== null) {
                try {
                    blacklistItems = WeaponMasterUtil.WEAPON_BLACKLIST.get()
                } catch (e) {
                    console.error('[武器之狐] 读取武器黑名单失败，已跳过该项：' + e)
                    blacklistItems = null
                }
            }
        }

        if (blacklistItems === null) return false

        try {
            return blacklistItems.contains(item)
        } catch (e) {
            return false
        }
    }

    /* ============================================================
     * ④ 判定
     * ============================================================ */

    /*
     * 模组 API：返回 WeaponType（sword / axe / hoe / pickaxe / shovel /
     * armor / projectile / wand / spell_book），不是装备返回 null。
     */
    function getModWeaponType(item) {
        if (WeaponMasterUtil === null) return null

        try {
            return WeaponMasterUtil.getTargetType(item)
        } catch (e) {
            console.error('[武器之狐] getTargetType 调用失败：' + e)
            return null
        }
    }

    // 手动补录白名单
    function isExtraWeapon(itemId) {
        if (itemId === null) return false
        return EXTRA_ID_SET[String(itemId).toLowerCase()] === true
    }

    function isWeaponOrArmor(stack) {
        var item = stack.getItem()
        if (item === null) return false

        var matched = getModWeaponType(item) !== null

        if (!matched && INCLUDE_SPECIAL) {
            matched = isSpecialItem(item)
        }

        if (!matched && EXTRA_WEAPON_IDS.length > 0) {
            matched = isExtraWeapon(String(stack.getId()))
        }

        if (!matched) return false

        if (USE_BLACKLIST && isBlacklisted(item)) return false

        return true
    }

    /* ============================================================
     * ⑤ 提示
     *
     * 类型文字直接复用模组自己的本地化键：
     *   ageofmythology.morph.screen.manual.weapon_master.<类型>
     * 特殊武器用源码里的 special 键。
     * ============================================================ */

    function announce(player, stack, item) {
        if (!ANNOUNCE) return

        try {
            var type = getModWeaponType(item)

            var typeDesc = type !== null
                ? type.getDesc()
                : Component.translatable('ageofmythology.morph.screen.manual.weapon_master.special')

            var message = Component.literal('§a[武器之狐] §7发现新的装备 §8» §f')
                .append(Component.translatable(item.getDescriptionId()))
                .append(Component.literal(' §8['))
                .append(typeDesc)
                .append(Component.literal('§8] §7' + String(stack.getId())))

            player.tell(message)
        } catch (e) {
            console.error('[武器之狐] 发送提示失败：' + e)
        }
    }

    /* ============================================================
     * ⑥ 记录
     * ============================================================ */

    function record(player, stack) {
        var item = stack.getItem()

        if (!isWeaponOrArmor(stack)) return

        if (WeaponMasterUtil === null) {
            console.error('[武器之狐] 模组判定入口不可用，无法写入记录')
            return
        }

        // 与 WeaponMasterEvents#addUsedWeapon 相同的查重方式
        if (WeaponMasterUtil.hasUsedWeapon(player, item)) return

        // 写入 capability 内存态，并由模组同步给客户端
        WeaponMasterUtil.addUsedWeapon(player, item)

        if (LOG) {
            console.info('[武器之狐] ★ 发现新的装备：' + String(stack.getId()))
        }

        announce(player, stack, item)
    }

    /* ============================================================
     * ⑦ 事件
     *
     * 只处理服务端玩家：
     *   - capability 的权威数据在服务端；
     *   - WeaponMasterUtil#addUsedWeapon 只对 ServerPlayer 发包同步。
     *
     * 这里的类型判定必须用 JS 的 instanceof 运算符：
     * Rhino 只在类对象上暴露静态成员，写 `ServerPlayer.isInstance(player)`
     * 会报 "has no public instance field or method named isInstance"；
     * 而 `x instanceof SomeClass` 走 NativeJavaClass.hasInstance，
     * 是 Rhino 唯一支持的 Java 类型判定写法。
     * ============================================================ */

    PlayerEvents.inventoryChanged(function (event) {
        var player = event.getPlayer()
        var stack = event.getItem()

        if (player === null || stack === null || stack.isEmpty()) return

        if (ServerPlayer !== null && !(player instanceof ServerPlayer)) return

        try {
            record(player, stack)
        } catch (e) {
            console.error('[武器之狐] 处理装备记录失败：' + e)
        }
    })
})()
