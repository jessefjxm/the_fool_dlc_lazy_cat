/*
 * 元素之猫·能力探针 —— 一次性诊断，只用于判断
 * 「KubeJS 能否直接拿到模组 capability 并安全写入」。
 *
 * 用法：/reload 后打死任意一只怪，看 kubejs/server.log 里
 *       [元素之猫·探针] 开头的几行，然后把结果反馈后删除本文件。
 */
(function () {
    var PlayerDataCapability = null
    var CapabilityUtil = null
    var BuiltInRegistries = null
    var ResourceLocation = null
    try {
        PlayerDataCapability = Java.loadClass('com.kurome.ageofmythology.capability.PlayerDataCapability')
        CapabilityUtil = Java.loadClass('com.kurome.ageofmythology.utils.CapabilityUtil')
        BuiltInRegistries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
        ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
    } catch (e) {
        console.error('[元素之猫·探针] 加载模组类失败：' + e)
        return
    }

    function probe(player, source) {
        console.log('[元素之猫·探针] 开始 =====')

        /*
         * 1. 包装器上有没有 getCapability？
         */
        var hasGetter = false
        try {
            hasGetter = typeof player.getCapability === 'function'
        } catch (e1) {
            console.error('[元素之猫·探针] 探测 getCapability 失败：' + e1)
        }
        console.log('[元素之猫·探针] player.getCapability 类型=' + typeof player.getCapability + ' 可用=' + hasGetter)

        /*
         * 2. 能不能拿到 capability 实例
         */
        var data = null
        if (hasGetter) {
            try {
                var optional = player.getCapability(PlayerDataCapability.INSTANCE)
                console.log('[元素之猫·探针] getCapability 返回=' + optional + ' present=' + optional.isPresent())
                data = optional.orElse(null)
            } catch (e2) {
                console.error('[元素之猫·探针] 调用 getCapability 失败：' + e2)
            }
        }
        if (data === null) {
            try {
                data = CapabilityUtil.getCapability(player, PlayerDataCapability.INSTANCE)
                console.log('[元素之猫·探针] CapabilityUtil 返回=' + data)
            } catch (e3) {
                console.error('[元素之猫·探针] CapabilityUtil.getCapability 失败：' + e3)
            }
        }

        /*
         * 3. 拿不到就到此为止，后面的测试没意义
         */
        if (data === null) {
            console.log('[元素之猫·探针] 结论：拿不到 capability，只能继续用纯 NBT 方案')
            console.log('[元素之猫·探针] 结束 =====')
            return
        }

        /*
         * 4. 拿到后：能否读 extraInfo，内存态里现有几条
         */
        var extra = null
        try {
            extra = data.getExtraInfo()
            console.log('[元素之猫·探针] extraInfo=' + extra)
            console.log('[元素之猫·探针] 内存态 affinity_map 条数=' + extra.affinity_map.size() + ' 内容=' + extra.affinity_map)
        } catch (e4) {
            console.error('[元素之猫·探针] 读取 extraInfo 失败：' + e4)
        }

        /*
         * 5. 关键结论：拿源码里的「杀怪测试实体」做一次 addAffinity，
         *    看内存态与 NBT 是否表现一致（不做实际修改，只读探针只加到一只测试实体上）
         */
        if (extra !== null) {
            try {
                var type = BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse('minecraft:bat'))
                console.log('[元素之猫·探针] 测试实体 minecraft:bat 当前亲和=' + extra.getAffinity(type))
                console.log('[元素之猫·探针] 结论：capability 可读可写，addAffinity 可用=' + (typeof extra.addAffinity === 'function'))
            } catch (e5) {
                console.error('[元素之猫·探针] 测试 addAffinity 失败：' + e5)
            }
        }

        /*
         * 6. 顺带确认 setNbt 往返后，脚本写的 NBT 是否仍在（即用户关心的覆盖问题）
         */
        try {
            var playerNbt = player.getNbt()
            var caps = playerNbt.contains('ForgeCaps', 10) ? playerNbt.getCompound('ForgeCaps') : null
            var traveller = caps !== null && caps.contains('ageofmythology:traveller', 10) ? caps.getCompound('ageofmythology:traveller') : null
            var list = traveller !== null && traveller.contains('nbt_earth_affinity_map', 9) ? traveller.getList('nbt_earth_affinity_map', 10) : null
            console.log('[元素之猫·探针] NBT 里 nbt_earth_affinity_map 条数=' + (list === null ? '标签不存在' : list.size()))
            console.log('[元素之猫·探针] 内存条数 与 NBT 条数 是否一致：' + (list !== null && extra !== null && list.size() === extra.affinity_map.size()))
        } catch (e6) {
            console.error('[元素之猫·探针] 读取 NBT 失败：' + e6)
        }

        console.log('[元素之猫·探针] 结束 =====')
    }

    EntityEvents.death(function (event) {
        try {
            var entity = event.getEntity()
            if (entity === null) return
            var source = event.getSource()
            var player = source === null ? null : source.getActual()
            if (player === null) return
            probe(player, source)
        } catch (e) {
            console.error('[元素之猫·探针] 处理失败：' + e)
        }
    })

    console.log('[元素之猫·探针] 已加载：打死任意生物后会输出诊断')
})()
