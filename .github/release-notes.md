## 下载后怎么用

1. 下载下面的 `the_fool_dlc_lazy_cat.zip` 并解压；
2. 包里就是全部 `.js` 和 `README.md`，**把它们全部**丢进整合包的 `kubejs\server_scripts\`，例如：

   ```
   D:\Games\Minecraft\.minecraft\versions\愚者 0.3.1\kubejs\server_scripts\
   ```

3. 进游戏执行 `/reload`（需要管理员权限），或者重新进入存档、重开游戏。

## 注意

- `server_scripts` 里的 `.js` 要**整套**放在一起，不要只挑几个；
- 以 `_` 开头的文件（`_悬停.js`）负责注册共用工具，必须保留；
- 联机时脚本要放在**服务端**的 `kubejs\server_scripts\` 下；
- 出问题看日志：整合包目录 `\logs\kubejs\server.log`。
