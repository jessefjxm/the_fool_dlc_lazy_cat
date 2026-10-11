# 愚者 DLC - 懒惰之猫

我非常喜欢愚者里的各类收集玩法：罪梦之猫系列、孤独症系列、旅行者系列。但是，肝起来太累了！

所以我整了一系列偷懒脚本，极大简化收集过程。

目标：把所有收集的难度降低到【食物收集】的水平——新档开始就能进行收集，并且可以快捷记录（0.3.0 自带一键吃）

---

## 下载（不想碰 git 的人看这里）

直接下打包好的压缩包，解压覆盖就能用：

- **最新稳定版**：<https://github.com/jessefjxm/the_fool_dlc_lazy_cat/releases/latest/download/the_fool_dlc_lazy_cat.zip>
- **最新构建**（每次更新 `main` 后自动打包，可能带还没正式发布的改动）：<https://github.com/jessefjxm/the_fool_dlc_lazy_cat/releases/download/rolling/the_fool_dlc_lazy_cat.zip>
- 全部版本：<https://github.com/jessefjxm/the_fool_dlc_lazy_cat/releases>

包内结构是 `kubejs\server_scripts\*.js`，所以**解压后直接覆盖到整合包的版本目录**即可，例如
`D:\Games\Minecraft\.minecraft\versions\愚者 0.3.1\`。压缩包里的 `使用说明.txt` 写的是同样的步骤。

> 打包由 GitHub Actions 自动完成，配置在 [`.github/workflows/release.yml`](.github/workflows/release.yml)：
> 打 `v*` tag 出正式版，推送到 `main` 自动刷新「最新构建」，两者附件名相同所以下载链接固定不变。

---

## 用法

把仓库里的脚本丢到整合包的 `kubejs\server_scripts\` 目录下，例如：

```
D:\Games\Minecraft\.minecraft\versions\愚者 0.3.1\kubejs\server_scripts\
```

然后执行 `/reload` 命令（如果你是管理员并且在游戏里），或者重新存档、重新开端，脚本就会生效。

> 名称以 `_` 开头的文件（`_悬停.js`）必须和其它脚本一起放入：
> KubeJS 按文件名排序加载，它需要排在前面才能注册好共用工具。

---

## 共同点

- 不需要佩戴特定道具，不需要使用特定技能
- 所有记录都直接写进玩家的 `ForgeCaps."ageofmythology:traveller"`，
  与模组自身的存档结构**完全一致**，所以：
  - 模组图鉴的「激活/总数」会同步显示
  - 属性加成会正常生效
  - 卸载脚本后已有记录不会丢

---

## 功能一览

| 脚本 | 记录内容 | 触发时机 |
| --- | --- | --- |
| 献祭之猫 | 遗物（curios `skull` 槽物品） | 物品进入背包 |
| 拾魔之猫 | 法术卷轴、升级法球 | 物品进入背包 |
| 书龙之猫 | 附魔（读附魔书） | 物品进入背包 |
| 坚韧之猫 | 伤害类型 | 受到伤害 |
| 酿态之猫 | 状态效果（Buff / Debuff） | 周期性扫描 |
| 贪食之狐 | 矿物方块 | 破坏方块 |
| 血鸣之狐 | 营火原料 | 物品进入背包 |
| 共振之狐 | Create 加工原料（石磨 / 粉碎轮） | 物品进入背包 |
| 探险之狐 | 结构 | 周期性扫描 |
| 陪伴之狐 | 陪伴生物 | 周期性扫描 |
| 武器之狐 | 装备（近战 / 工具 / 远程 / 防具 / 魔杖 / 法术书） | 物品进入背包 |
| 元素之猫 | 火系 / 深渊系 / 岩系生物 | 击杀生物 |
| 魔法师 | 魔法系 / 巫法系生物 | 击杀生物 |
| 孤独症 | 唱片、生物群系 | 物品进入背包 / 周期性扫描 |
| 旅行者 | 生物群系（7 个维度同步） | 周期性扫描 |

### 辅助文件

| 文件 | 作用 |
| --- | --- |
| `_悬停.js` | **共用悬停工具**：提供 `global.hover.hoverItem / hoverItemWithSnbt / hoverText`，被所有功能脚本调用 |
| `物品获取监听.js` | 基础设施：补齐被「背包 / RS 网络」吞掉的物品获取事件。本身不记录任何收集内容 |

### 查询工具

| 命令 | 作用 |
| --- | --- |
| `/aomaffinity [fire\|abyss\|geomancy\|list]` | 元素之猫：列出各系标签的怪物名单 |
| `/aommagicschool [magic\|goety\|list]` | 魔法师：列出各系标签的怪物名单 |
| `/aomcatalog` | 图鉴上限：核对各分类「手册总数」，用于校验脚本里写死的上限值 |

---

## 收集进度显示

所有功能脚本的提示都会在末尾附加进度，格式为 **`(当前/目标/上限)`**：

```
[献祭之猫] 发现新的遗物 » 黄金羊毛 [ageofmythology:xxx] (261/951)
[书龙之猫] 发现新的附魔 » 锋利 [minecraft:sharpness] (34/128/169)
                                                        ↑当前 ↑目标 ↑上限
```

- **当前**：绿色，已记录条数
- **目标**：金色，模组自身的成就 / 反转阈值（没有阈值的分类不显示这一档）
- **上限**：白色，本整合包内能收集到的记录总数

### 各分类的阈值与上限

| 脚本 | 目标（阈值） | 上限 | 上限来源 |
| --- | --- | --- | --- |
| 献祭之猫 | —（无阈值） | 951 | `curios:skull` 标签物品数 |
| 拾魔之猫 · 法球 | 12 | 14 | `UpgradeOrbItem` 实例数 |
| 拾魔之猫 · 卷轴 | 128 | 198 | 已启用法术数 |
| 书龙之猫 | 128 | 169 | 附魔注册表 |
| 坚韧之猫 | 64 | 293 | 伤害类型注册表 |
| 酿态之猫 | 128 | 671 | 状态效果注册表 |
| 贪食之狐 | 32 | 54 | `forge:ores` 方块标签 53 + 空气 |
| 血鸣之狐 | 32 | 103 | 营火配方原料去重后的可匹配物品数 |
| 共振之狐 | 128 | 301 | Create 石磨 / 粉碎轮原料去重后的物品数 |
| 探险之狐 | 256 | 668 | `StructureCatalogService.snapshot()` |
| 陪伴之狐 | 256 | 986 | `CompanionRecordCatalog.canRecord` |
| 武器之狐 | 256 | 各类型不同 | 模组的 `getXxxList().size()`（剑 = 319） |
| 元素之猫 | —（无阈值） | 35 / 31 / 20 | 各系实体标签条目数（火 / 深渊 / 岩） |
| 魔法师 | —（无阈值） | 37 / 59 | 各系实体标签条目数（魔法 / 巫法） |
| 孤独症 · 唱片 | —（无阈值） | 106 | `music_discs` 标签物品数 |
| 孤独症 · 群系 | —（无阈值） | 400 | 群系注册表 |
| 旅行者 | —（无阈值） | 400 | 群系注册表 |

> 上限数字是**核对后写死**的常量。整合包增删模组或改配置后，
> 执行一次 `/aomcatalog` 对照，再更新对应脚本里的 `MAX_*` 即可。

> 有中间档的脚本（拾魔之猫起）才有「目标」；
> 献祭之猫、元素之猫、魔法师、孤独症、旅行者没有与"收集数量"同维度的模组阈值，
> 所以只显示两档。

---

## 鼠标悬停提示

所有提示都支持**鼠标移上去显示 tooltip**，用 MC 原生的 `HoverEvent` 实现。

### 悬停落在哪

以献祭之猫为例：

```
[献祭之猫] 发现新的遗物 » 黄金羊毛 [ageofmythology:xxx] (261/951)
 ↑ 悬停：献祭之猫道具        ↑ 悬停：该遗物        ↑ 无悬停
```

- **前缀 `[xx之x]`**：悬停显示**该脚本对应的本体道具**
- **条目名称**：悬停显示**本次记录的那个物品**（或该对象的关联信息）
- 中间的说明文字、`[id]`、末尾的进度括号：**保持无悬停**

### 脚本与本体道具的对应关系

| 脚本 | 对应道具 | item id |
| --- | --- | --- |
| 献祭之猫 | 献祭之猫 | `ageofmythology:ageofmythology_cat_of_sacrifice_item` |
| 拾魔之猫 | 拾魔之猫 | `ageofmythology:ageofmythology_cat_of_mana_pick_item` |
| 书龙之猫 | 书龙之猫 | `ageofmythology:ageofmythology_cat_of_dragon_book_item` |
| 坚韧之猫 | 坚韧之猫 | `ageofmythology:ageofmythology_cat_of_tenacity_item` |
| 酿态之猫 | 酿态之猫 | `ageofmythology:ageofmythology_cat_of_brewing_item` |
| 元素之猫 | 元素之猫 | `ageofmythology:ageofmythology_cat_of_elements_item` |
| 贪食之狐 | 贪食之狐 | `ageofmythology:ageofmythology_fox_of_gluttony_item` |
| 血鸣之狐 | 血鸣之狐 | `ageofmythology:ageofmythology_fox_of_blood_echo_item` |
| 共振之狐 | 共振之狐 | `ageofmythology:ageofmythology_fox_of_resonance_item` |
| 探险之狐 | 探险之狐 | `ageofmythology:ageofmythology_fox_of_exploration_item` |
| 陪伴之狐 | 陪伴之狐 | `ageofmythology:ageofmythology_fox_of_companion_item` |
| 武器之狐 | 武器之狐 | `ageofmythology:ageofmythology_fox_of_weapon_item` |
| 魔法师 | **大魔法师遗物** | `ageofmythology:ageofmythology_grand_mage_item` |
| 旅行者 | **旅者核心** | `ageofmythology:ageofmythology_travel_core_item` |
| 孤独症 | **【孤独症：聆听】** | `ageofmythology:ageofmythology_autism_listen_item` |

### 两类悬停的内容

**物品悬停（`show_item`）** —— 弹出真实的物品卡片：

| 脚本 | 条目悬停的物品 |
| --- | --- |
| 献祭之猫 | 该遗物本身 |
| 拾魔之猫 | 升级法球 / **装着该法术的卷轴**（带 spell_container NBT） |
| 书龙之猫 | **写着该附魔的附魔书**（带 StoredEnchantments NBT） |
| 贪食之狐 | 该矿物方块对应的物品 |
| 血鸣之狐 | 该营火原料 |
| 共振之狐 | 该加工原料 |
| 武器之狐 | 该装备本身 |
| 孤独症（唱片） | 该唱片 |

**文字悬停（`show_text`）** —— 显示自定义关联信息：

| 脚本 | 悬停内容 |
| --- | --- |
| 元素之猫 | 实体 ID、所属学派、当前已记录 / 上限、阈值说明 |
| 魔法师 | 实体 ID、所属学派、当前已记录 / 上限、阈值说明 |
| 坚韧之猫 | 伤害类型 msgId、注册表 ID、死亡消息键、当前 / 上限、阈值 |
| 酿态之猫 | 效果 ID、类型、药水名称键、当前 / 上限、阈值 |
| 探险之狐 | 结构 ID、当前 / 上限、阈值 |
| 陪伴之狐 | 实体 ID、当前 / 上限、阈值 |
| 旅行者 | 群系 ID、当前 / 上限、阈值说明 |
| 孤独症（群系） | 群系 ID、当前 / 上限、阈值说明 |

> 为什么有些是文字而不是物品：结构、群系、伤害类型、状态效果、生物
> **不是物品**，挂物品卡片会显示错误内容，所以改用文字悬停把关联信息列出来。

---

## 各脚本实现细节

### 献祭之猫
- **记录**：`nbt_sacrifice_item`，条目格式 `{item: "<物品id>"}`
- **判定**：物品属于 `ageofmythology` 且能放入 Curios 的 `skull` 槽
- **触发**：`PlayerEvents.inventoryChanged`
- **上限**：951（`curios:skull` 标签物品数，与模组手册同源）
- **阈值**：无。`CatOfSacrificeItem.bonus_count = 12` 是「佩戴超过 12 个遗物时加成翻倍」，
  与收集数量不是同一维度，所以不显示中间档

### 拾魔之猫
- **记录**：
  - `nbt_spell_scroll`，条目格式 `{desc: "<法术id>"}`
  - `nbt_upgrade_orb`，条目格式 `{item: "<物品id>"}`
- **判定**：
  - 卷轴 = 物品为 `irons_spellbooks:scroll`，法术 id 读它的 `irons_spellbooks:spell_container` NBT
  - 法球 = 物品类名为 `io.redspace.ironsspellbooks.item.UpgradeOrbItem`
- **阈值 / 上限**：法球 `12 / 14`，卷轴 `128 / 198`
- **悬停**：卷轴卡片带 `spell_container` NBT，所以卡片里能看到具体法术（名称 + 等级）

### 书龙之猫
- **记录**：`nbt_enhancement_book`，条目格式 `{desc: "<附魔id>"}`
- **判定**：只认附魔书（`minecraft:enchanted_book`），一本书带多个附魔会各记一条
- **阈值 / 上限**：`128 / 169`
- **悬停**：附魔书卡片手工拼 `StoredEnchantments` NBT，
  所以移上去能看到是哪个附魔、几级

### 坚韧之猫
- **记录**：`nbt_damage_type`，条目格式 `{desc: "<msgId>"}`
- **判定**：受伤害时取 `DamageSource.getMsgId()`
  —— **注意模组存的是 msgId 而不是注册表 id**：
  `minecraft:indirect_magic` → `indirectMagic`、`goety:shock` → `goety.shock`
- **阈值 / 上限**：`64 / 293`
- **向下兼容**：早期版本写的是注册表 id，脚本会在**进入存档时自动迁移**：
  注册表 id → msgId、并合并重复条目（幂等，跑过之后不再改动）

### 酿态之猫
- **记录**：`nbt_effect_type`，条目格式 `{desc: "<效果id>"}`
- **判定**：周期性扫描玩家身上的状态效果
- **阈值 / 上限**：`128 / 671`

### 贪食之狐
- **记录**：`nbt_gluttony_fox_eat_block`，条目格式 `{desc: "<方块id>"}`
- **判定**：破坏的方块属于 `forge:ores` 方块标签（另含空气 1 个）
- **阈值 / 上限**：`32 / 54`

### 血鸣之狐
- **记录**：`nbt_blood_fox_item`，条目格式 `{item: "<物品id>"}`
- **判定**：物品能作为 `minecraft:campfire_cooking` 配方的原料
  —— 配方在 `ServerEvents.loaded` 里从 `RecipeManager` 扫描一次
- **阈值 / 上限**：`32 / 103`（上限由脚本自身扫描结果决定）

### 共振之狐
- **记录**：`nbt_resonance_fox_item`，条目格式 `{item: "<物品id>"}`
- **判定**：物品能作为 `create:milling`（石磨）或 `create:crushing`（粉碎轮）的原料
- **阈值 / 上限**：`128 / 301`（上限由脚本自身扫描结果决定）

### 探险之狐
- **记录**：`nbt_explor_structure`，条目格式 `{desc: "<结构id>"}`
- **判定**：周期性扫描玩家所在位置的结构，**无视高度**
- **阈值 / 上限**：`256 / 668`

### 陪伴之狐
- **记录**：`nbt_spyglass_record`，条目格式 `{desc: "<实体id>"}`
- **判定**：看向 64 格内可被陪伴系统记录的生物
  （`CompanionRecordCatalog.canRecord`，即有默认属性的实体）
- **阈值 / 上限**：`256 / 986`

### 武器之狐
- **记录**：交给模组自己的 `WeaponMasterUtil.addUsedWeapon`（写入 `nbt_has_used_weapon`），
  所以 capability 内存态 / 存档 / 客户端同步三处永远一致
- **判定**：`WeaponMasterUtil.getTargetType(item)`，即那 9 个类型：
  剑 / 斧 / 锄 / 镐 / 锹 / 防具 / 远程武器 / 魔杖 / 法术书
- **阈值 / 上限**：`256` / 该类型的图鉴条目数（剑 = 319）
  - 上限直接问模组：`getSwordList() / getAxeList() / ...`，
    与图鉴武器大师页同源（内部同样过滤 `WEAPON_BLACKLIST`）
  - 类型标签为**青色、后置**（`[剑]`），与模组提示风格一致

### 元素之猫
- **记录**：`nbt_earth_affinity_map`，条目格式 `{entityType: "<实体id>", value: 5.0}`
  —— `value` 固定写满 5.0（模组对单个怪物的封顶值），所以击杀一只即满亲和
- **判定**：实体属于模组标签 `#ageofmythology:fire` / `abyss` / `geomancy`
  —— 顺序即优先级，命中第一个即记录
- **进度**：两档 `(当前/上限)`，三个系各自计数
  （亲和表是三系共用的一张表，所以按标签分别统计当前值）
- **阈值**：无（每个怪物各自 `value` 5.0 封顶）
- **查询**：`/aomaffinity [fire|abyss|geomancy|list]`

### 魔法师
- **记录**：`nbt_magic_skills`，条目格式 `{entityType: "<实体id>", value: 5.0}`
  - `value` 规则：`value = max(已有值, 5.0)`，**只补不覆盖**
- **判定**：实体属于模组标签 `#ageofmythology:magic`（魔法系）/ `#ageofmythology:goety`（巫法系）
- **进度**：两档 `(当前/上限)`，两个系各自计数
- **阈值**：无（每种生物各自 5.0 封顶）
- **查询**：`/aommagicschool [magic|goety|list]`

### 孤独症
- **记录**：两组共用 `nbt_listened_discs*`
  - 唱片：`nbt_listened_discs<N> = "listen:item.<命名空间>.<路径>"`
  - 群系：`nbt_listened_discs<N> = "perform:biome.<命名空间>.<路径>"`
  - 条数记录在 `nbt_listened_discs_size`
- **进度**：分别两档 `(当前/上限)` —— 唱片 106、群系 400
  （两类混在同一张表里，所以按 `listen:` / `perform:` 前缀分别统计当前值）
- **阈值**：无

### 旅行者
- **记录**：`VisitBiomes0..N`，条数记录在 `VisitBiomesSize`；
  每次进入新群系**一次写 7 个维度**
  （`lostcity / otherside / overworld / the_aether / the_end / the_nether / twilight_forest`）
- **进度**：两档 `(当前/上限)`，当前值按**群系 id 去重**统计（不是记录条数）
- **阈值**：无

---

## 实现上的坑（改脚本前建议先看）

这些都是实际调试出来的结论，写在对应脚本的注释里，这里做个索引。

### KubeJS 与 Java 交互

- **悬停的官方入口全被屏蔽**：
  `HoverEvent.showItem / showText`、`Action.buildHoverEvent` 都取不到；
  `Component$Serializer.fromJson` 有重载歧义；
  `component.withStyle(回调)` 会抛 `argument type mismatch`。
  可行写法只有：`Style.EMPTY.withHoverEvent(event)` + `setStyle`。
- **`SHOW_ITEM` 与 `SHOW_TEXT` 的值类型不同**：
  前者必须是 `HoverEvent$ItemStackInfo` 实例（传字符串或 Component 都会**崩客户端**），
  后者必须是 `Text`（传 `Component`）。
- **原生 `ItemStack` 必须自己 new**：包装器完全不暴露底层栈
  （`.itemStack` / `.minecraftItemStack` / `.getItemStack` 都取不到）。
- **NBT 方法走 `Nbt` 命名**：本环境只暴露 `setNbt / getNbt / getOrCreateTag /
  getTagElement / addTagElement`，`setTag / getTag` 是 `undefined`。
- **`ItemStack.of(CompoundTag)` 不可用**：EndingLibrary 通过 mixin 往 `ItemStack`
  注入了同名的 `of(ItemStack)`，Rhino 解析时必然报重载歧义。
- **`MutableComponent.append(...)` 是原地修改**：
  绝不能拿「已挂悬停的组件」当基底去 append 后面的文字，
  否则整条消息都会继承那个悬停。
  正确写法是基底用全新的 `Component.literal('')`。
- **`Component.translatable` 在同一 tick 内返回同一个缓存实例**：
  原地 `setStyle` 会污染所有引用它的地方。
- **块级 `function` 声明在命令执行时取不到**：辅助函数必须写在 IIFE 作用域。
- **`loadClass` 必须包 try/catch**：加载期任何异常都会让 KubeJS 丢弃整份脚本。
- **重复声明会让整份脚本加载失败**（`redeclaration of var` / `redeclaration of function`）。
- **反射不可用**：`getClass()` / `getMethods()` 点不出来，
  所以诊断要靠 `toString()` 或逐项探针。

### 模组侧的行为

- **伤害类型存的是 `msgId`**，不是注册表 id（见坚韧之猫）。
- **`DamageType.getMsgId()` 在本环境不存在**，
  但 `toString()` 里带 `msgId=...`，只能正则抠。
- **环境伤害路径上 `DamageSource.getActual()` 等返回 `undefined` 而不是 `null`**，
  直接调 `.isPlayer()` 会报错，必须先判 `undefined`。
- **模组有个共享实例 bug**：`WeaponType.getDesc()` 返回枚举里的共享组件，
  而模组自己对它调了 `withStyle(GREEN).withStyle(BOLD)`（原地修改），
  所以涨过一次熟练度后那段文案会永久变绿变粗。
  脚本里用 `copy()` + `RESET` 规避，不去改那个共享实例。
- **纯写 NBT 不会刷新客户端 UI**：
  必须 `player.setNbt(...)` 之后再调 `data.sync(player)`，
  否则道具说明要等到重新登录才更新。

---

## 免责声明

这些脚本会直接写玩家的 capability 数据。
虽然写入结构与模组自身完全一致，但**建议先在测试存档里试**，
并定期备份 `saves/<存档名>/playerdata/`。
