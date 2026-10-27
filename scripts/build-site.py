#!/usr/bin/env python3
"""主神空间只维护一份页面：page/zhushen.html。
- claude.ai 的 artifact 直接发布这个文件；
- 网站版由本脚本生成 public/index.html：在页面脚本之前插入 /platform.js（替代 claude.ai 的能力）。
用法：python3 scripts/build-site.py"""
import pathlib, sys
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "page" / "zhushen.html").read_text(encoding="utf-8")
anchor = '<meta name="claude:viewport-fit-sides" content="cover">'
if src.count(anchor) != 1:
    sys.exit("找不到插入位置：" + anchor)
out = src.replace(anchor, anchor + '\n<script src="/platform.js"></script>\n<meta name="robots" content="noindex">', 1)
(root / "public").mkdir(exist_ok=True)
(root / "public" / "index.html").write_text(out, encoding="utf-8")
print("public/index.html 已生成", len(out), "字符")
