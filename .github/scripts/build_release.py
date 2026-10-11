#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把仓库里的 KubeJS 脚本打包成一个可以直接解压使用的 zip。

用法：
    python .github/scripts/build_release.py          # 输出 dist/the_fool_dlc_lazy_cat.zip
    python .github/scripts/build_release.py --list   # 只列出打包内容，不生成 zip

zip 内部结构（全部平铺在根目录，没有多余文件夹层级）：
    *.js        仓库根目录下的全部脚本
    README.md   仓库说明

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
# "" 表示直接放在 zip 根目录；以后要分目录（例如 client_scripts）在这里加一行
LAYOUT: list[tuple[str, str]] = [
    ("*.js", ""),
]

# 额外塞进 zip 根目录的仓库文件（缺失就报错，避免悄悄发出一个不完整的包）
EXTRA_ROOT_FILES = ("README.md",)

# 正式版和滚动版都用同一个附件名，这样下载链接可以固定不变
ASSET_NAME = "the_fool_dlc_lazy_cat.zip"


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
            arcname = f"{target_dir}/{source.name}" if target_dir else source.name
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


def build_zip(output: Path, entries: list[tuple[Path, str]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, arcname in entries:
            archive.write(source, arcname)


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
    parser.add_argument("--list", action="store_true", help="只列出打包内容，不生成 zip")
    args = parser.parse_args()

    entries = collect()
    if args.list:
        for _, arcname in entries:
            print(arcname)
        print(f"共 {len(entries)} 个文件（全部平铺在 zip 根目录）")
        return 0

    output = Path(args.output)
    if not output.is_absolute():
        output = REPO_ROOT / output
    build_zip(output, entries)

    print(f"已生成 {output}")
    print(f"  文件数量：{len(entries)}")
    print(f"  压缩包大小：{output.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
