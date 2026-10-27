#!/usr/bin/env python3
"""检查线上 artifact 是否和仓库的 page/zhushen.html 一致。
用法：python3 scripts/check-drift.py <从 Artifact read 保存下来的 html 文件>
退出码：0 = 一致；1 = 有差异（差异会打印出来）；2 = 参数或文件错误。
唯一允许的差异是 cloudOn 那一行（网站版专用，artifact 版没有 __SITE 判断）。"""
import difflib, re, sys

SITE_LINE = "function cloudOn(){return !window.__SITE&&!!MCP&&S.sharedMem!==false}"
ART_LINE = "function cloudOn(){return !!MCP&&S.sharedMem!==false}"


def body(text):
    # Artifact read 的结果外面会包一层说明，只取 <cowritten-artifact-html> 里面或者 <!doctype 开始的部分
    m = re.search(r"<cowritten-artifact-html>\s*(.*?)\s*</cowritten-artifact-html>", text, re.S)
    if m:
        text = m.group(1)
    i = text.find("<!doctype")
    return text[i:] if i >= 0 else text


def main():
    if len(sys.argv) != 2:
        print(__doc__); return 2
    live = body(open(sys.argv[1], encoding="utf-8").read())
    repo = open("page/zhushen.html", encoding="utf-8").read().replace(SITE_LINE, ART_LINE)
    a, b = live.strip().splitlines(), repo.strip().splitlines()
    if a == b:
        print("一致：artifact 和仓库没有差异"); return 0
    print("有差异（< 是线上 artifact，> 是仓库）：")
    for line in list(difflib.unified_diff(a, b, "artifact", "repo", n=1, lineterm=""))[:200]:
        print(line[:300])
    return 1


if __name__ == "__main__":
    sys.exit(main())
