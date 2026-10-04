/*
 * ============================================================
 * 物品获取监听 - 补齐被「背包 / RS 网络」吞掉的物品获取事件
 * ============================================================
 *
 * Minecraft : Forge 1.20.1
 * KubeJS    : 2001.6.5-build.16
 *
 * ------------------------------------------------------------
 * 一、问题
 * ------------------------------------------------------------
 *
 * PlayerEvents.inventoryChanged 的真实来源是
 * dev.latvian.mods.kubejs.player.KubeJSInventoryListener，
 * 它实现 ContainerListener，只在「玩家物品栏菜单的某个槽位
 * 内容变化」时触发（KubeJSInventoryListener#slotChanged，
 * 且要求该槽位的 container 就是玩家 Inventory）。
 *
 * 所以只要物品从头到尾没进过玩家物品栏，事件就永远不会出现：
 *
 *   1. Sophisticated Backpacks 的 magnet / pickup 升级
 *      物品进的是背包自己的库存。背包内容并不存在背包物品的
 *      NBT 里，而是存在 BackpackStorage（SavedData，按
 *      contentsUuid 索引，key: inventory / upgradeInventory），
 *      背包物品本身的 NBT 只有 contentsUuid / 颜色 / 槽位数。
 *      → 玩家物品栏没有任何变化，事件不触发。
 *
 *   2. rs_integration 的 rs_magnet_upgrade / rs_pickup_upgrade
 *      rs_integration 的 MagnetUpgradeWrapperMixin 在
 *      MagnetUpgradeWrapper#tryToInsertItem 的 HEAD 直接 cancel，
 *      把物品塞进升级绑定的 RS 网络（升级 NBT:
 *      RSIStorageBackend / RSIStorageNetwork）。
 *      → 背包、玩家物品栏双双没有变化。
 *
 * 模组自己只把这类「隐形获得」喂给了 FTB Quests
 * （InsertedStackDelta.report → ExternalItemProgressBridge），
 * 和 KubeJS 侧完全无关。
 *
 * ------------------------------------------------------------
 * 二、做法
 * ------------------------------------------------------------
 *
 * 不改模组、不改已有脚本，只「补发事件」：
 *
 *   每 N tick 主动扫描玩家身上所有会存物品的容器，和上一轮
 *   快照做差集；把新增的物品重新包装成 InventoryChangedEventJS，
 *   再 post 回 PlayerEvents.INVENTORY_CHANGED。
 *
 * 注意 post 必须走反射：EventHandler 本身是 Rhino 的 Scriptable，
 * 脚本里 x.post(...) / x.hasListeners() 都取不到方法，
 * 直接调用会报 TypeError: Cannot find default value for object.
 * 细节与原因见下面「六、踩坑记录」和文件里的注释。
 *
 * 于是 共振之狐.js / 拾魔之猫.js / 武器之狐.js / 献祭之猫.js /
 * 孤独症.js / 书龙之猫.js / 血鸣之狐.js 里原有的
 *
 *     PlayerEvents.inventoryChanged(function (event) { ... })
 *
 * 一行都不用改，就能收到这些「隐形获得」的物品。
 * 这些脚本内部都有「已记录则跳过」的去重，重复派发是安全的。
 *
 * 扫描对象：
 *   1. 玩家物品栏 0-35 / 护甲 36-39 / 副手 40
 *      （Inventory#getItem 是分区的，41 个槽位一次扫完）
 *   2. Curios（借用 rs_integration 的 CuriosAccess.stacks）
 *   3. 上述物品里所有 SB 背包的内容
 *      CapabilityBackpackWrapper → IBackpackWrapper
 *        → getInventoryHandler()
 *   4. 背包升级槽里所有带 RS 绑定的升级
 *      getUpgradeHandler() → StorageBackpackUtils.readReference
 *        → StorageBackpackUtils.resolve → StorageSession#snapshotItems
 *
 * ------------------------------------------------------------
 * 三、差分的键
 * ------------------------------------------------------------
 *
 * 物品签名 = itemId + '#' + nbt.hashCode()
 *
 *   - 不含槽位：背包自动整理 / 排序搬槽位不会误报
 *   - 含 NBT  ：两张不同的法术卷轴（同 id 不同 NBT）不会被吞掉
 *   - 不含数量：同一种物品再捡几个不会重复派发
 *
 * ------------------------------------------------------------
 * 四、已知取舍
 * ------------------------------------------------------------
 *
 *   - 第一次见到某个容器时只建立基线，不补记里面的历史物品。
 *     想让它第一次扫描时把容器里已有的物品全部补记一遍，
 *     把 BACKFILL 改成 true（会刷一屏提示，但每件只记一次）。
 *   - 只覆盖「玩家带着」的背包。放在地上的背包由模组记到放置者
 *     名下，本脚本不扫描（放在地上的背包磁铁吸货不会记账）。
 *   - RS 网络里出现新物品就算「获得」：网络被机器 / 其他玩家
 *     喂货时也会记账。这是「存储容器差分」方案的固有取舍，
 *     要关掉把 ENABLE_RS 改成 false。
 *
 * ------------------------------------------------------------
 * 五、排查命令
 * ------------------------------------------------------------
 *
 *   /obtainscan      查看模块状态、识别到的背包与 RS 绑定网络
 *   /obtainscan rs   强制快照一次绑定的 RS 网络，报告物品种类数
 *   DEBUG = true 时，每次补发与每次失败都会写日志
 *
 * ------------------------------------------------------------
 * 六、踩坑记录（KubeJS 脚本的通用坑，值得记住）
 * ------------------------------------------------------------
 *
 * 1. 实现了 Scriptable 的 Java 对象，在脚本里「看不到 Java 方法」。
 *
 *    KubeJS 的 WrapFactory.wrap 第一条：
 *        if (obj == null || obj == Undefined.instance
 *                || obj instanceof Scriptable) return obj;
 *    也就是说，凡是自己实现了 Rhino Scriptable 的 Java 对象
 *    （EventHandler 继承 BaseFunction 就是典型），会被原样交给脚本。
 *    此时属性查找走的是 JS 对象的原型链，Java 方法完全不可见：
 *
 *        typeof PlayerEvents.inventoryChanged.post        -> undefined
 *        PlayerEvents.inventoryChanged.hasListeners()     ->
 *            TypeError: Cannot find default value for object.
 *
 *    报错为什么这么奇怪：Rhino 想报「不是一个函数」，
 *    但先要把这个函数对象转成字符串，而它的原型链里没有 JS 层的
 *    toString / valueOf，于是先抛出 ScriptableObject 的
 *    msg.default.value（"Cannot find default value for object."）。
 *
 *    对策：从 Class 取 Method 再 invoke（本脚本 dispatch 的做法），
 *    或者改用普通 Java 对象（NativeJavaObject）承载这类调用。
 *
 * 2. 反过来，Java 的 Map / List / Set 是能用的：
 *    WrapFactory 会把它们包成 NativeJavaMap / NativeJavaList，
 *    这些是 NativeJavaObject 的子类，Java 方法照常可读。
 *    （global 就是一个 HashMap。）
 * ============================================================
 */

(function () {
    /* ============================================================
     * 可调参数
     * ============================================================ */
    var BACKPACK_INTERVAL = 10   // 背包扫描周期（tick），10 = 0.5 秒
    var RS_INTERVAL = 40         // RS 网络扫描周期（tick），40 = 2 秒
    var BACKFILL = true         // 第一次看到容器时，是否把里面的东西全补记一遍
    var DEBUG = false            // true = 每次补发都写日志
    var ENABLE_RS = true         // false = 只处理背包，不碰 RS 网络
    var MAX_TRACKED_BAGS = 64    // 每个玩家最多跟踪多少个背包

    /*
     * 玩家物品栏的槽位总数：
     *   0-35 主背包 / 36-39 护甲 / 40 副手
     * Inventory#getItem(int) 会自动在三个分区之间换算。
     */
    var PLAYER_SLOTS = 41

    var TAG = '[物品获取监听]'

    /* ============================================================
     * 类加载
     *
     * 用 loadClass 包一层：加载期任何 loadClass 抛错都会让
     * KubeJS 丢弃整份脚本，所以每个类单独 try。
     * ============================================================ */
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error(TAG + ' 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var InventoryChangedEventJS = loadClass('dev.latvian.mods.kubejs.player.InventoryChangedEventJS')
    var CapabilityBackpackWrapper = loadClass('net.p3pp3rf1y.sophisticatedbackpacks.api.CapabilityBackpackWrapper')
    var StorageBackpackUtils = loadClass('com.huanghuang.rsintegration.mods.sophisticatedbackpacks.StorageBackpackUtils')
    var CuriosAccess = loadClass('com.huanghuang.rsintegration.util.CuriosAccess')

    /*
     * RS 直读通道用的类。
     * rs_integration 的 StorageSession#snapshotItems 有一层
     * 「会话可用性 + 权限 + 快照映射」，实测会出现
     * 「返回成功但物品表里没有刚吸进去的物品」的情况，
     * 所以再准备一条绕开它的路：直接拿 RS 自己的
     * network.getItemStorageCache().getList()。
     */
    var RSIntegrationNetwork = loadClass('com.huanghuang.rsintegration.network.RSIntegrationNetwork')
    var ResourceKey = loadClass('net.minecraft.resources.ResourceKey')
    var ResourceLocation = loadClass('net.minecraft.resources.ResourceLocation')
    var Registries = loadClass('net.minecraft.core.registries.Registries')
    var BlockPos = loadClass('net.minecraft.core.BlockPos')
    var StringArgumentType = loadClass('com.mojang.brigadier.arguments.StringArgumentType')

    var HAS_RS_DIRECT = ENABLE_RS && (RSIntegrationNetwork !== null) && (ResourceKey !== null) &&
        (ResourceLocation !== null) && (Registries !== null) && (BlockPos !== null)

    var HAS_BACKPACKS = (InventoryChangedEventJS !== null) && (CapabilityBackpackWrapper !== null)
    var HAS_RS = ENABLE_RS && (InventoryChangedEventJS !== null) && ((StorageBackpackUtils !== null) || HAS_RS_DIRECT)
    var HAS_CURIOS = (CuriosAccess !== null)
    var SCAN_ENABLED = HAS_BACKPACKS || HAS_RS

    /*
     * 事件句柄
     *
     * PlayerEvents 是 KubeJS 的 EventGroupWrapper（一个 HashMap），
     * PlayerEvents.inventoryChanged 取到的就是 EventHandler 本身，
     * 它带 post(ScriptTypeHolder, Object, EventJS) 方法，
     * 正是 KubeJSInventoryListener 内部用的那个入口。
     */
    var INVENTORY_CHANGED = null
    try {
        if (typeof PlayerEvents !== 'undefined' && PlayerEvents !== null) {
            INVENTORY_CHANGED = PlayerEvents.inventoryChanged
        }
    } catch (e) {
        console.error(TAG + ' 取 PlayerEvents.inventoryChanged 失败：' + e)
    }

    if (INVENTORY_CHANGED === null || InventoryChangedEventJS === null) {
        console.error(TAG + ' 无法补发 inventoryChanged，脚本不生效。')
        return
    }

    /* ============================================================
     * 补发通道：为什么必须走反射，以及怎么拿到 Class 对象
     *
     * 坑 1：EventHandler 继承 Rhino 的 BaseFunction，本身实现了 Scriptable。
     * KubeJS 的 WrapFactory.wrap 第一句就是
     *     if (obj instanceof Scriptable) return obj;
     * 所以脚本里拿到的 PlayerEvents.inventoryChanged 是一个
     * 「纯函数对象」，post / hasListeners 这些 Java 方法一个都取不到：
     *
     *     typeof PlayerEvents.inventoryChanged.post   ->  undefined
     *     直接写 x.post(...)  ->  TypeError: Cannot find default value for object.
     *
     * （那条报错的来源：Rhino 要把这个函数对象转成字符串来报错，
     *   而它的原型链里没有 JS 层的 toString/valueOf。）
     * KubeJS 自己是在 Java 侧调 post 的（KubeJSInventoryListener），
     * 脚本侧没有这条捷径，只能从 Class 上取 Method 再 invoke。
     *
     * 坑 2：Java.loadClass() 拿到的是 NativeJavaClass，
     * 它只暴露「目标类的静态成员」，所以
     *     Java.loadClass('...EventHandler').getMethods()
     * 会报 has no public instance field or method named "getMethods"。
     * KubeJS 的 Rhino 分支在 NativeJavaClass 上留了一个入口：
     *     __javaObject__   ->   真正的 java.lang.Class 实例
     * 必须先取到 Class 实例，getMethods() 才有意义。
     * ============================================================ */
    function javaClassOf(name) {
        try {
            var nativeClass = Java.loadClass(name)
            var javaClass = nativeClass.__javaObject__
            if (javaClass !== null && javaClass !== undefined) return javaClass
        } catch (e) {
            console.error(TAG + ' 取 ' + name + ' 的 Class 对象失败：' + e)
        }
        /* 兜底：从任意 Java 对象经 ClassLoader 拿 */
        try {
            return console.getClass().getClassLoader().loadClass(name)
        } catch (e2) {
            console.error(TAG + ' 兜底获取 ' + name + ' 的 Class 对象也失败：' + e2)
        }
        return null
    }

    var POST_METHOD = null
    var LISTENERS_METHOD = null

    try {
        var eventHandlerClass = javaClassOf('dev.latvian.mods.kubejs.event.EventHandler')
        if (eventHandlerClass !== null) {
            var methods = eventHandlerClass.getMethods()
            for (var mi = 0; mi < methods.length; mi++) {
                var method = methods[mi]
                var methodName = String(method.getName())
                var paramCount = method.getParameterCount()
                if (methodName === 'hasListeners' && paramCount === 0 && LISTENERS_METHOD === null) {
                    LISTENERS_METHOD = method
                } else if (methodName === 'post' && paramCount === 3 && POST_METHOD === null) {
                    /*
                     * 三个三参数重载要挑准：
                     *   post(ScriptTypeHolder, EventJS,  EventExceptionHandler)  ← 不要
                     *   post(EventJS,          Object,   EventExceptionHandler)  ← 不要
                     *   post(ScriptTypeHolder, Object,   EventJS)                ← 要这个
                     * 按第 2、3 个参数的类型名判定。
                     */
                    var paramTypes = method.getParameterTypes()
                    if (String(paramTypes[1].getName()) === 'java.lang.Object' &&
                        String(paramTypes[2].getName()) === 'dev.latvian.mods.kubejs.event.EventJS') {
                        POST_METHOD = method
                    }
                }
            }
        }
    } catch (e) {
        console.error(TAG + ' 反射查找 EventHandler.post 失败：' + e)
    }

    /*
     * 冒烟测试：真的 invoke 一次 hasListeners()。
     * 它没有任何副作用，只用来确认反射通道在这个版本上确实通。
     */
    var POST_OK = false
    if (POST_METHOD !== null) {
        try {
            if (LISTENERS_METHOD !== null) String(LISTENERS_METHOD.invoke(INVENTORY_CHANGED, []))
            POST_OK = true
        } catch (e2) {
            console.error(TAG + ' 反射冒烟测试失败：' + e2)
        }
    }
    if (!POST_OK) {
        console.error(TAG + ' 拿不到 EventHandler.post，补发功能不可用（其它脚本不受影响）。')
        return
    }

    /* ============================================================
     * 快照
     *
     * snapshots[玩家] = {
     *     bags:     { <背包 contentsUuid>: { <签名>: ItemStack } },
     *     bagOrder: [ 背包 key 的加入顺序，用于淘汰 ],
     *     rs:       { <网络 key>:         { <签名>: ItemStack } },
     *     refs:     { <网络 key>:         StorageReference }
     * }
     * ============================================================ */
    var snapshots = {}

    function playerKey(player) {
        try {
            return String(player.getUUID())
        } catch (e) {
            try {
                return String(player.getName().getString())
            } catch (e2) {
                return 'unknown'
            }
        }
    }

    function snapshotOf(player) {
        var key = playerKey(player)
        var snap = snapshots[key]
        if (snap === undefined) {
            snap = { bags: {}, bagOrder: [], rs: {}, refs: {} }
            snapshots[key] = snap
        }
        return snap
    }

    function hasKey(map, key) {
        return Object.prototype.hasOwnProperty.call(map, key)
    }

    /* ============================================================
     * 物品签名
     * ============================================================ */
    function signatureOf(stack) {
        var id = '?'
        try {
            id = String(stack.getId())
        } catch (e) {
            /* 读不到 id 就退化成未知物品，不影响其它物品 */
        }
        var hash = 0
        try {
            var nbt = stack.getNbt()
            if (nbt !== null) hash = nbt.hashCode()
        } catch (e2) {
            hash = 0
        }
        return id + '#' + hash
    }

    /* ============================================================
     * 把一个 IItemHandler（或 ItemStackHandler）里的物品收进 out
     * ============================================================ */
    function collectHandler(handler, out) {
        if (handler === null || handler === undefined) return
        var slots = 0
        try {
            slots = handler.getSlots()
        } catch (e) {
            return
        }
        for (var i = 0; i < slots; i++) {
            var stack = null
            try {
                stack = handler.getStackInSlot(i)
            } catch (e2) {
                continue
            }
            if (stack === null || stack.isEmpty()) continue
            var sig = signatureOf(stack)
            if (!hasKey(out, sig)) out[sig] = stack
        }
    }

    /* ============================================================
     * 玩家身上所有可能装东西的槽位
     * ============================================================ */
    function carriedStacks(player) {
        var out = []

        try {
            var inv = player.getInventory()
            if (inv !== null) {
                for (var i = 0; i < PLAYER_SLOTS; i++) {
                    var stack = null
                    try {
                        stack = inv.getItem(i)
                    } catch (e) {
                        continue
                    }
                    if (stack !== null && !stack.isEmpty()) out.push(stack)
                }
            }
        } catch (e2) {
            console.error(TAG + ' 读取玩家物品栏失败：' + e2)
        }

        if (HAS_CURIOS) {
            try {
                var curios = CuriosAccess.stacks(player)
                if (curios !== null) {
                    var n = curios.size()
                    for (var j = 0; j < n; j++) {
                        var cs = curios.get(j)
                        if (cs !== null && !cs.isEmpty()) out.push(cs)
                    }
                }
            } catch (e3) {
                if (DEBUG) console.error(TAG + ' 读取 Curios 失败：' + e3)
            }
        }

        return out
    }

    /* ============================================================
     * SB 背包
     *
     * 只有带 contentsUuid 的物品才可能是被打开过的 SB 背包，
     * 先用 NBT 快速排除，再走 capability 拿权威包装器。
     * ============================================================ */
    function backpackWrapperOf(stack) {
        if (!HAS_BACKPACKS) return null
        try {
            var nbt = stack.getNbt()
            if (nbt === null || !nbt.contains('contentsUuid')) return null
        } catch (e) {
            return null
        }
        try {
            var lazy = stack.getCapability(CapabilityBackpackWrapper.getCapabilityInstance())
            if (lazy === null || !lazy.isPresent()) return null
            return lazy.orElse(null)
        } catch (e2) {
            if (DEBUG) console.error(TAG + ' 读取背包 capability 失败：' + e2)
            return null
        }
    }

    function backpackKeyOf(stack) {
        try {
            var nbt = stack.getNbt()
            if (nbt === null || !nbt.contains('contentsUuid')) return null
            var tag = nbt.get('contentsUuid')
            return tag === null ? null : String(tag)
        } catch (e) {
            return null
        }
    }

    /* ============================================================
     * 从背包升级槽里收集 RS 绑定
     *
     * 绑定写在升级物品自己的 NBT 上：
     *   RSIStorageBackend / RSIStorageNetwork（新格式）
     *   RSBlockPos / RSBlockDimension        （旧格式）
     * 两种格式 StorageBackpackUtils.readReference 都能读。
     * ============================================================ */
    function collectReferences(handler, refs) {
        if (!HAS_RS || handler === null || handler === undefined) return
        var slots = 0
        try {
            slots = handler.getSlots()
        } catch (e) {
            return
        }
        for (var i = 0; i < slots; i++) {
            try {
                var upgrade = handler.getStackInSlot(i)
                if (upgrade === null || upgrade.isEmpty()) continue
                var tag = upgrade.getNbt()
                if (tag === null) continue
                var ref = StorageBackpackUtils.readReference(tag)
                if (ref === null) continue
                var key = String(ref.backendId().value()) + '|' + String(ref.networkId())
                if (!hasKey(refs, key)) refs[key] = ref
            } catch (e2) {
                if (DEBUG) console.error(TAG + ' 读取升级绑定失败：' + e2)
            }
        }
    }

    /* ============================================================
     * 快照一个 RS 网络的全部物品种类
     *
     * 通道 A：rs_integration 自己的 StorageSession
     *   snapshotItems(ServerPlayer) → StorageSnapshotResult
     *     → snapshot() → Optional<StorageSnapshot>
     *       → items() → List<StoredItem> → stack()
     *   必须在服务端线程调用（StorageThreadGuard 会检查）。
     *
     * 通道 B：绕开 A，直接用 RS 自己的 API
     *   network.getItemStorageCache().getList().getStacks()
     *   实测 A 会「返回成功但表里没有刚吸进去的物品」，
     *   所以两条都跑，结果取并集。
     * ============================================================ */
    function parseReference(networkId) {
        /* rs_integration 的 RefinedStorageReference 是包私有的，
           只能照它的格式自己拆：v1|<维度>@<x>,<y>,<z> */
        try {
            var value = String(networkId)
            if (value.indexOf('v1|') !== 0) return null
            var body = value.substring(3)
            var at = body.lastIndexOf('@')
            if (at <= 0 || at === body.length - 1) return null
            var coords = body.substring(at + 1).split(',')
            if (coords.length !== 3) return null
            var x = parseInt(coords[0], 10)
            var y = parseInt(coords[1], 10)
            var z = parseInt(coords[2], 10)
            if (isNaN(x) || isNaN(y) || isNaN(z)) return null
            return { dimension: body.substring(0, at), x: x, y: y, z: z }
        } catch (e) {
            return null
        }
    }

    function collectNetworkViaRsIntegration(player, ref, out) {
        if (StorageBackpackUtils === null) return false
        try {
            var session = StorageBackpackUtils.resolve(player, ref)
            if (session === null) return false

            var result = session.snapshotItems(player)
            if (result === null || !result.successful()) return false

            var optional = result.snapshot()
            if (optional === null || !optional.isPresent()) return false

            var items = optional.get().items()
            var n = items.size()
            for (var i = 0; i < n; i++) {
                var stack = null
                try {
                    stack = items.get(i).stack()
                } catch (e) {
                    continue
                }
                if (stack === null || stack.isEmpty()) continue
                var sig = signatureOf(stack)
                if (!hasKey(out, sig)) out[sig] = stack
            }
            return true
        } catch (e2) {
            if (DEBUG) console.error(TAG + ' 快照 RS 网络失败：' + e2)
            return false
        }
    }

    /*
     * 通道 B：直接问 RS 要物品表。
     * network.getItemStorageCache().getList().getStacks()
     */
    function collectNetworkDirect(player, ref, out) {
        if (!HAS_RS_DIRECT || ref === null) return false
        var loc = parseReference(ref.networkId())
        if (loc === null) return false
        try {
            var server = player.getServer()
            if (server === null) return false
            var dimKey = ResourceKey.create(Registries.DIMENSION, new ResourceLocation(loc.dimension))
            var network = RSIntegrationNetwork.resolveNetwork(server, dimKey, new BlockPos(loc.x, loc.y, loc.z))
            if (network === null) return false
            var cache = network.getItemStorageCache()
            if (cache === null) return false
            var list = cache.getList()
            if (list === null) return false
            var entries = list.getStacks().toArray()
            for (var i = 0; i < entries.length; i++) {
                var stack = null
                try {
                    stack = entries[i].getStack()
                } catch (e) {
                    continue
                }
                if (stack === null || stack.isEmpty()) continue
                var sig = signatureOf(stack)
                if (!hasKey(out, sig)) out[sig] = stack
            }
            return true
        } catch (e2) {
            if (DEBUG) console.error(TAG + ' RS 直读网络失败：' + e2)
            return false
        }
    }

    /*
     * 两条通道都跑，结果并入同一个 map。
     * 返回「至少有一条通道读成功」。
     */
    function collectNetwork(player, ref, out) {
        var viaA = collectNetworkViaRsIntegration(player, ref, out)
        var viaB = collectNetworkDirect(player, ref, out)
        return viaA || viaB
    }

    /* ============================================================
     * 差分
     *
     * previous 不存在 = 第一次看到这个容器：
     *   建立基线，只有 BACKFILL 打开时才把当前内容全部派发。
     * ============================================================ */
    function isEmptySnapshot(map) {
        for (var k in map) {
            if (hasKey(map, k)) return false
        }
        return true
    }

    function diffInto(store, key, current, out) {
        var previous = store[key]

        if (previous === undefined) {
            if (BACKFILL) {
                for (var k in current) {
                    if (hasKey(current, k)) out.push(current[k])
                }
            }
            store[key] = current
            return
        }

        /*
         * 读到空快照就保留上一轮。
         *
         * 容器偶尔会「成功但读空」：RS 网络缓存还没刷新、
         * 背包内容还没装载完等等。如果直接接受这个空快照，
         * 下一轮所有物品都会变成「新增」，一次补发一屏假记录。
         * 宁可漏记一次，也不要误报一屏。
         */
        if (isEmptySnapshot(current) && !isEmptySnapshot(previous)) return

        for (var sig in current) {
            if (!hasKey(current, sig)) continue
            if (!hasKey(previous, sig)) out.push(current[sig])
        }
        store[key] = current
    }

    function rememberBag(snap, key) {
        snap.bagOrder.push(key)
        while (snap.bagOrder.length > MAX_TRACKED_BAGS) {
            var oldest = snap.bagOrder.shift()
            delete snap.bags[oldest]
        }
    }

    /* ============================================================
     * 补发 inventoryChanged
     *
     * 第三个参数是槽位号，这里没有真实槽位，传 -1；
     * 已有脚本只用 getPlayer() / getItem()，不看槽位。
     * ============================================================ */
    var noListenerWarned = false

    /*
     * 有没有监听器（反射调 hasListeners()，见上面的说明）。
     * 读不到就当作「有」，宁可多做一次派发。
     */
    function hasListeners() {
        if (LISTENERS_METHOD === null) return true
        try {
            return String(LISTENERS_METHOD.invoke(INVENTORY_CHANGED, [])) === 'true'
        } catch (e) {
            return true
        }
    }

    function dispatch(player, items) {
        if (items.length === 0) return
        if (!hasListeners()) {
            if (!noListenerWarned) {
                noListenerWarned = true
                console.warn(TAG + ' 当前没有任何 PlayerEvents.inventoryChanged 监听器，补发的物品无人接收（检查其它脚本是否加载成功）。')
            }
            return
        }

        for (var i = 0; i < items.length; i++) {
            var stack = items[i]
            if (DEBUG) {
                var id = '?'
                try {
                    id = String(stack.getId())
                } catch (e) {
                    /* 日志用，失败无所谓 */
                }
                console.info(TAG + ' 补发获得物品：' + id)
            }
            try {
                /*
                 * 等价于 Java 侧的
                 *   INVENTORY_CHANGED.post(player, stack.getItem(),
                 *       new InventoryChangedEventJS(player, stack, -1))
                 * 只是必须走反射，原因见文件上半部分。
                 */
                POST_METHOD.invoke(INVENTORY_CHANGED, [player, stack.getItem(), new InventoryChangedEventJS(player, stack, -1)])
            } catch (e2) {
                console.error(TAG + ' 补发 inventoryChanged 失败：' + e2)
            }
        }
    }

    /* ============================================================
     * 扫描：玩家身上的 SB 背包内容 + 背包里的 RS 绑定
     * ============================================================ */
    function scanBackpacks(player, snap) {
        var refs = {}
        var diff = []
        var stacks = carriedStacks(player)

        for (var i = 0; i < stacks.length; i++) {
            var stack = stacks[i]
            var wrapper = backpackWrapperOf(stack)
            if (wrapper === null) continue

            var bagKey = backpackKeyOf(stack)
            if (bagKey === null) continue

            var current = {}
            try {
                collectHandler(wrapper.getInventoryHandler(), current)
            } catch (e) {
                if (DEBUG) console.error(TAG + ' 读取背包内容失败：' + e)
            }
            try {
                collectReferences(wrapper.getUpgradeHandler(), refs)
            } catch (e2) {
                if (DEBUG) console.error(TAG + ' 读取背包升级槽失败：' + e2)
            }

            var isNew = !hasKey(snap.bags, bagKey)
            diffInto(snap.bags, bagKey, current, diff)
            if (isNew) rememberBag(snap, bagKey)
        }

        dispatch(player, diff)
        snap.refs = refs
        return refs
    }

    /* ============================================================
     * 扫描：背包里所有 RS 绑定网络的物品表
     * ============================================================ */
    function scanNetworks(player, snap) {
        if (!HAS_RS || snap.refs === null) return
        var keys = Object.keys(snap.refs)
        if (keys.length === 0) return

        var diff = []
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i]
            var current = {}
            var ok = collectNetwork(player, snap.refs[key], current)
            if (!ok) {
                if (DEBUG) console.info(TAG + ' RS 扫描 ' + key + '：两条通道都读不到')
                continue
            }
            if (DEBUG) {
                console.info(TAG + ' RS 扫描 ' + key + '：读到 ' + Object.keys(current).length + ' 种物品')
            }
            diffInto(snap.rs, key, current, diff)
        }
        dispatch(player, diff)
    }

    /* ============================================================
     * 注册：玩家 Tick
     * ============================================================ */
    PlayerEvents.tick(function (event) {
        if (!SCAN_ENABLED) return

        var player = event.getPlayer()
        if (player === null || player === undefined) return

        try {
            if (player.level.isClientSide()) return
        } catch (e) {
            return
        }

        var age = 0
        try {
            age = player.age
        } catch (e2) {
            return
        }

        try {
            var snap = snapshotOf(player)
            if (age % BACKPACK_INTERVAL === 0) {
                scanBackpacks(player, snap)
            }
            /*
             * RS 扫描放在背包扫描之后：
             * 同一个 tick 里两者都到期时，先用刚刷新的绑定列表。
             */
            if (HAS_RS && age % RS_INTERVAL === 0) {
                scanNetworks(player, snap)
            }
        } catch (e3) {
            console.error(TAG + ' 扫描失败：' + e3)
        }
    })

    /* ============================================================
     * 注册：玩家退出时清掉快照
     * ============================================================ */
    PlayerEvents.loggedOut(function (event) {
        try {
            var player = event.getPlayer()
            if (player === null || player === undefined) return
            delete snapshots[playerKey(player)]
        } catch (e) {
            console.error(TAG + ' 清理快照失败：' + e)
        }
    })

    /* ============================================================
     * 排查命令 /obtainscan [rs]
     * ============================================================ */
    function collectCarriedRefs(player) {
        var refs = {}
        var bagCount = 0
        var stacks = carriedStacks(player)
        for (var i = 0; i < stacks.length; i++) {
            var wrapper = backpackWrapperOf(stacks[i])
            if (wrapper === null) continue
            bagCount++
            try {
                collectReferences(wrapper.getUpgradeHandler(), refs)
            } catch (e) {
                if (DEBUG) console.error(TAG + ' 读取升级槽失败：' + e)
            }
        }
        return { refs: refs, bagCount: bagCount }
    }

    function reportStatus(player) {
        var snap = snapshotOf(player)
        var found = collectCarriedRefs(player)
        var keys = Object.keys(found.refs)

        player.tell(Component.literal('§a' + TAG + ' §7模块状态'))
        player.tell(Component.literal('§8» §7SB 背包：' + (HAS_BACKPACKS ? '§a可用' : '§c不可用') + ' §8| §7RS 网络：' + (HAS_RS ? '§a可用' : '§c不可用') + '（开关 ' + (ENABLE_RS ? '开' : '关') + '） §8| §7Curios：' + (HAS_CURIOS ? '§a可用' : '§c不可用')))
        player.tell(Component.literal('§8» §7携带的 SB 背包：§f' + found.bagCount + ' §7个，已跟踪 §f' + Object.keys(snap.bags).length + ' §7个'))
        player.tell(Component.literal('§8» §7补发通道：' + (POST_OK ? '§a反射可用' : '§c不可用') + ' §8| §7inventoryChanged 监听器：' + (hasListeners() ? '§a有' : '§c无')))
        player.tell(Component.literal('§8» §7识别到的 RS 绑定网络：§f' + keys.length + ' §7个'))
        for (var i = 0; i < keys.length; i++) {
            player.tell(Component.literal('§8  - §f' + keys[i]))
        }
        player.tell(Component.literal('§8» §7周期：背包 §f' + BACKPACK_INTERVAL + ' tick §7/ RS §f' + RS_INTERVAL + ' tick §7，补记历史物品 ' + (BACKFILL ? '§a开' : '§c关')))
    }

    function reportNetworks(player) {
        var found = collectCarriedRefs(player)
        var keys = Object.keys(found.refs)

        if (keys.length === 0) {
            player.tell(Component.literal('§c' + TAG + ' §7没有找到 RS 绑定网络。'))
            player.tell(Component.literal('§8» §7需要先拿 rs_magnet_upgrade / rs_pickup_upgrade 右键 RS 控制器完成绑定，再把它装进背包。'))
            return
        }

        for (var i = 0; i < keys.length; i++) {
            var ref = found.refs[keys[i]]
            var viaA = {}
            var viaB = {}
            var okA = collectNetworkViaRsIntegration(player, ref, viaA)
            var okB = collectNetworkDirect(player, ref, viaB)
            player.tell(Component.literal('§8» §f' + keys[i]))
            player.tell(Component.literal('§8   - §7rs_integration 会话：' + (okA ? '§a成功' : '§c失败') + ' §7种类 §f' + Object.keys(viaA).length))
            player.tell(Component.literal('§8   - §7RS API 直读：' + (okB ? '§a成功' : '§c失败') + ' §7种类 §f' + Object.keys(viaB).length))
            var ids = Object.keys(viaB).length > 0 ? Object.keys(viaB) : Object.keys(viaA)
            if (ids.length > 0) {
                var sample = []
                for (var j = 0; j < ids.length && j < 6; j++) sample.push(ids[j].replace(/#-?\d+$/, ''))
                player.tell(Component.literal('§8     例：§f' + sample.join('§7, §f')))
            }
        }
    }

    /*
     * /obtainscan find <物品id>
     * 一次性告诉你这个物品现在到底在哪儿：
     *   玩家物品栏 / 携带的背包 / 每个绑定网络的 会话通道 与 API 直读
     */
    function reportFind(player, needle) {
        var id = String(needle).trim()
        if (id.length === 0) {
            player.tell(Component.literal('§c' + TAG + ' §7用法：/obtainscan find <物品id>，例如 /obtainscan find minecraft:glowstone'))
            return
        }

        player.tell(Component.literal('§a' + TAG + ' §7查找 §f' + id))

        /* 1. 玩家物品栏 */
        var inSlots = 0
        try {
            var inv = player.getInventory()
            for (var i = 0; i < PLAYER_SLOTS; i++) {
                var stack = inv.getItem(i)
                if (stack !== null && !stack.isEmpty() && String(stack.getId()) === id) inSlots += stack.getCount()
            }
        } catch (e) {
            player.tell(Component.literal('§8» §7物品栏读取失败：' + e))
        }
        player.tell(Component.literal('§8» §7玩家物品栏：§f' + inSlots + ' §7个'))

        /* 2. 携带的背包内容 */
        var bagTotal = 0
        var stacks = carriedStacks(player)
        for (var b = 0; b < stacks.length; b++) {
            var wrapper = backpackWrapperOf(stacks[b])
            if (wrapper === null) continue
            var count = 0
            try {
                var handler = wrapper.getInventoryHandler()
                var slots = handler.getSlots()
                for (var s = 0; s < slots; s++) {
                    var bs = handler.getStackInSlot(s)
                    if (bs !== null && !bs.isEmpty() && String(bs.getId()) === id) count += bs.getCount()
                }
            } catch (e2) {
                if (DEBUG) console.error(TAG + ' 读背包失败：' + e2)
            }
            bagTotal += count
        }
        player.tell(Component.literal('§8» §7携带的 SB 背包：§f' + bagTotal + ' §7个'))

        /* 3. 每个绑定网络（两条通道分别找） */
        var found = collectCarriedRefs(player)
        var keys = Object.keys(found.refs)
        if (keys.length === 0) {
            player.tell(Component.literal('§8» §7没有绑定网络可查'))
        }
        for (var k = 0; k < keys.length; k++) {
            var ref = found.refs[keys[k]]
            var viaA = {}
            var viaB = {}
            var okA = collectNetworkViaRsIntegration(player, ref, viaA)
            var okB = collectNetworkDirect(player, ref, viaB)
            player.tell(Component.literal('§8» §f' + keys[k]))
            player.tell(Component.literal('§8   - §7会话通道：' + (okA ? (countMatching(viaA, id) > 0 ? '§a找到 ' + countMatching(viaA, id) + ' 个' : '§e没有') : '§c失败')))
            player.tell(Component.literal('§8   - §7API 直读：' + (okB ? (countMatching(viaB, id) > 0 ? '§a找到 ' + countMatching(viaB, id) + ' 个' : '§e没有') : '§c失败')))
        }

        player.tell(Component.literal('§8» §7（若三处都没有：物品可能被 §f虚空升级§7 吃掉了，或还在 §f放置的背包§7 里）'))
    }

    function countMatching(map, id) {
        var total = 0
        var prefix = id + '#'
        for (var sig in map) {
            if (!hasKey(map, sig)) continue
            if (sig.indexOf(prefix) !== 0) continue
            try {
                total += map[sig].getCount()
            } catch (e) {
                total += 1
            }
        }
        return total
    }

    try {
        ServerEvents.commandRegistry(function (event) {
            var commands = event.commands
            var builder = commands.literal('obtainscan')
                .executes(function (context) {
                    var player = context.getSource().getPlayer()
                    if (player === null || player === undefined) return 0
                    reportStatus(player)
                    return 1
                })
                .then(commands.literal('rs').executes(function (context) {
                    var player = context.getSource().getPlayer()
                    if (player === null || player === undefined) return 0
                    reportNetworks(player)
                    return 1
                }))
            if (StringArgumentType !== null) {
                builder = builder.then(commands.literal('find')
                    .then(commands.argument('id', StringArgumentType.string())
                        .executes(function (context) {
                            var player = context.getSource().getPlayer()
                            if (player === null || player === undefined) return 0
                            reportFind(player, StringArgumentType.getString(context, 'id'))
                            return 1
                        })))
            }
            event.register(builder)
        })
    } catch (e) {
        console.error(TAG + ' 注册 /obtainscan 失败：' + e)
    }

    /* ============================================================
     * 启动日志
     * ============================================================ */
    console.info(TAG + ' ========================================')
    console.info(TAG + ' 已加载：背包内容 / RS 网络 差分补发 inventoryChanged')
    console.info(TAG + ' 补发通道：反射 EventHandler.post(ScriptTypeHolder, Object, EventJS)')
    console.info(TAG + ' SB 背包：' + (HAS_BACKPACKS ? '可用' : '不可用') + '，RS 会话通道：' + (HAS_RS ? '可用' : '不可用') + '，RS API 直读：' + (HAS_RS_DIRECT ? '可用' : '不可用') + '，Curios：' + (HAS_CURIOS ? '可用' : '不可用'))
    console.info(TAG + ' 排查命令：/obtainscan   /obtainscan rs   /obtainscan find <物品id>')
    console.info(TAG + ' ========================================')
})()
