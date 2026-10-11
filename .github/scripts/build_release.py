#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把仓库里的 KubeJS 脚本打包成一个可以直接解压使用的 zip。

用法：
    python .github/scripts/build_release.py                 # 输出 dist/the_fool_dlc_lazy_cat.zip
    python .github/scripts/build_release.py --label v0.3.1  # 把版本号写进包内的使用说明
    python .github/scripts/build_release.py --list          # 只列出会被打包的文件，不生成 zip

zip 内部结构：
    kubejs/server_scripts/*.js   仓库根目录下的全部脚本
    README.md                    仓库说明
    使用说明.txt                  给不用 git 的人看的极简说明

用 Python 而不是 Compress-Archive 打包，是因为脚本文件名都是中文：
Python 的 zipfile 会把文件名按 UTF-8 写入并置上 UTF-8 标志位（bit 11），
Windows 资源管理器和 7-Zip 解压出来都不会乱码。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# 仓库根目录下的 glob -> 放进 zip 的哪个目录
# 以后要加 client_scripts / startup_scripts，在这里加一行就行
LAYOUT: list[tuple[str, str]] = [
    ("*.js", "kubejs/server_scripts"),
]

# 额外塞进 zip 根目录的仓库文件（缺失就报错，避免悄悄发出一个不完整的包）
EXTRA_ROOT_FILES = ("README.md",)

# 正式版和滚动版都用同一个附件名，这样下载链接可以固定不变
ASSET_NAME = "the_fool_dlc_lazy_cat.zip"

USAGE_TXT = """懒惰之猫 - 愚者 DLC 收集辅助脚本
打包版本：{label}

【怎么用】
1. 解压本压缩包。
2. 里面是一个 kubejs 文件夹，把它覆盖到整合包的版本目录，例如：
       D:\\Games\\Minecraft\\.minecraft\\versions\\愚者 0.3.1\\
   覆盖之后脚本应该位于：
       ...\\versions\\愚者 0.3.1\\kubejs\\server_scripts\\
3. 进游戏后执行 /reload（需要管理员权限），或者重新进入存档、重开游戏。

【注意】
- server_scripts 里的 .js 文件要整套放在一起，不要只挑几个放进去。
- 以 _ 开头的文件（_悬停.js）负责注册共用工具，必须保留。
- 联机时脚本要放在服务端的 kubejs\\server_scripts\\ 下。
- 更新整合包后脚本可能失效，重新解压覆盖一次即可。

【出问题看这里】
- 日志：整合包目录\\logs\\kubejs\\server.log
- 报错多半是整合包更新导致接口变化，去仓库 Issues 反馈。
"""


def _tracked_paths() -> set[str] | None:
    """git 已跟踪文件的相对路径（posix 风格）；不在 git 仓库里时返回 None。"""
    try:
        completed = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return {item.decode("utf-8") for item in completed.stdout.split(b"\0") if item}


def _default_label() -> str:
    """没传 --label 时，用 git describe 生成一个像 v0.3.1-2-g1a2b3c4 的版本号。"""
    try:
        completed = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "未标注"
    label = completed.stdout.decode("utf-8", "replace").strip()
    return label or "未标注"


def collect() -> list[tuple[Path, str]]:
    """返回 [(源文件, zip 内路径)]，只收 git 已跟踪的文件。"""
    tracked = _tracked_paths()
    entries: list[tuple[Path, str]] = []
    seen: set[str] = set()

    for pattern, target_dir in LAYOUT:
        matches = sorted(path for path in REPO_ROOT.glob(pattern) if path.is_file())
        if tracked is not None:
            matches = [
                path
                for path in matches
                if path.relative_to(REPO_ROOT).as_posix() in tracked
            ]
        if not matches:
            raise SystemExit(
                f"错误：{pattern} 没有匹配到任何已跟踪文件，"
                "打包脚本可能和仓库结构脱节了。"
            )
        for source in matches:
            arcname = f"{target_dir}/{source.name}"
            if arcname in seen:
                raise SystemExit(f"错误：{arcname} 被重复打包")
            seen.add(arcname)
            entries.append((source, arcname))

    for name in EXTRA_ROOT_FILES:
        source = REPO_ROOT / name
        if not source.is_file():
            raise SystemExit(f"错误：找不到 {name}")
        if name in seen:
            raise SystemExit(f"错误：{name} 被重复打包")
        seen.add(name)
        entries.append((source, name))

    return entries


def build_zip(output: Path, entries: list[tuple[Path, str]], label: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, arcname in entries:
            archive.write(source, arcname)
        archive.writestr("使用说明.txt", USAGE_TXT.format(label=label))


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="把 KubeJS 脚本打包成 zip")
    parser.add_argument(
        "-o",
        "--output",
        default=f"dist/{ASSET_NAME}",
        help=f"输出路径，相对仓库根目录（默认 dist/{ASSET_NAME}）",
    )
    parser.add_argument("--label", default="", help="写进包内使用说明的版本号")
    parser.add_argument("--list", action="store_true", help="只列出打包内容，不生成 zip")
    args = parser.parse_args()

    entries = collect()
    if args.list:
        for _, arcname in entries:
            print(arcname)
        print(f"使用说明.txt  ({len(entries)} 个文件 + 使用说明)")
        return 0

    label = args.label.strip() or _default_label()
    output = Path(args.output)
    if not output.is_absolute():
        output = REPO_ROOT / output
    build_zip(output, entries, label)

    print(f"已生成 {output}")
    print(f"  版本标记：{label}")
    print(f"  文件数量：{len(entries)} + 使用说明.txt")
    print(f"  压缩包大小：{output.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
