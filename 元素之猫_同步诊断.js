/*
 * ============================================================
 * 元素之猫·同步诊断 - 对比「服务端内存态」与「客户端 UI 读的那份」
 * ============================================================
 *
 * 用途：
 *   元素之猫写入 capability 后，客户端 UI（元素之猫道具的说明文本）
 *   靠 ClientSyncPlayerDataCapability 数据包刷新。
 *   如果命令输出里「客户端」那份还是旧数据，就说明包没送到，
 *   问题不在写入侧，而在同步侧。
 *
 * 用法：
 *   /aomaffinitysync          打印服务端与客户端两边的亲和表
 *   /aomaffinitysync packet   额外主动触发一次 sync 再打印
 *   /aomaffinitysync fix      把超过 5.0 的旧记录压回 5.0 并同步
 *                             （修早期 addAffinity 累加 bug 留下的脏数据）
 *
 * 说明：
 *   数据同时写入 kubejs/server.log，便于复制反馈。
 *   排查完可直接删除本文件。
 *
 * ============================================================
 */

(function () {
    function loadClass(name) {
        try {
            return Java.loadClass(name)
        } catch (e) {
            console.error('[元素之猫·同步诊断] 加载类失败：' + name + '，错误：' + e)
            return null
        }
    }

    var PlayerDataCapability = loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
    var CapabilityUtil = loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')

    /*
     * 取某玩家 capability 里的亲和表，返回描述字符串
     */
    function dump(label, player, out) {
        if (player === null) {
            out.push(label + '：玩家对象为空')
            return
        }
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data === null) {
                out.push(label + '：拿不到 capability')
                return
            }
            var map = data.getExtraInfo().affinity_map
            out.push(label + '：条数=' + map.size() + ' 内容=' + map)
        } catch (e) {
            out.push(label + '：读取失败 ' + e)
        }
    }

    /*
     * 主动让服务端把当前 capability 推给客户端
     */
    function pushSync(player, out) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data === null) {
                out.push('主动 sync：拿不到 capability')
                return
            }
            data.sync(player)
            out.push('主动 sync：已调用 data.sync(player)')
        } catch (e) {
            out.push('主动 sync：失败 ' + e)
        }
    }

    /*
     * 把某玩家亲和表里超过 5.0 的值压回 5.0，并同步给客户端。
     *
     * 背景：元素之猫早期版本误用 addAffinity(累加)，会把已有记录
     * 变成 10.0。本命令用于修复历史脏数据，正常情况不会用到。
     * 只压不增：低于 5.0 的值不动，避免覆盖模组自己累积的进度。
     */
    function capAtFive(player, out) {
        try {
            var data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
            if (data === null) {
                out.push('修正：拿不到 capability')
                return
            }
            var map = data.getExtraInfo().affinity_map
            var fixed = 0
            /*
             * 先收集要改的 key 再统一 put：
             * 避免在 entrySet 迭代中直接改 map 触发并发修改异常。
             */
            var keys = map.keySet().toArray()
            for (var i = 0; i < keys.length; i++) {
                var value = map.get(keys[i])
                if (value !== null && value.doubleValue() > 5.0) {
                    map.put(keys[i], 5.0)
                    fixed++
                }
            }
            data.sync(player)
            out.push('修正：把 ' + fixed + ' 条超过 5.0 的记录压回 5.0，并已 sync')
        } catch (e) {
            out.push('修正：失败 ' + e)
        }
    }

    ServerEvents.commandRegistry(function (event) {
        var commands = event.commands
        var builder = commands.literal('aomaffinitysync')
            .executes(function (context) {
                report(context.getSource(), false)
                return 1
            })
            .then(commands.literal('packet').executes(function (context) {
                report(context.getSource(), true)
                return 1
            }))
            .then(commands.literal('fix').executes(function (context) {
                var out = []
                capAtFive(context.getSource().getPlayer(), out)
                dump('修正后服务端', context.getSource().getPlayer(), out)
                for (var i = 0; i < out.length; i++) {
                    console.log('[元素之猫·同步诊断] ' + out[i])
                    context.getSource().sendSuccess(Component.literal('§a[同步诊断] §f' + out[i]), false)
                }
                return 1
            }))
        event.register(builder)
    })

    function report(source, doSync) {
        var out = []
        var serverPlayer = source.getPlayer()
        var clientPlayer = null
        try {
            clientPlayer = Client.player
        } catch (e) {
            out.push('客户端玩家：读取失败 ' + e)
        }

        if (doSync) pushSync(serverPlayer, out)
        dump('服务端内存态', serverPlayer, out)
        dump('客户端UI数据', clientPlayer, out)

        for (var i = 0; i < out.length; i++) {
            console.log('[元素之猫·同步诊断] ' + out[i])
            source.sendSuccess(Component.literal('§a[同步诊断] §f' + out[i]), false)
        }
    }

    console.log('[元素之猫·同步诊断] 已加载：/aomaffinitysync [packet]')
})()
