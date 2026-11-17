"""字段目录：规范字段名、取数层级、表头别名、单元格类型。

xhs_fetch.py（采集）与 feishu_sheet.py（写飞书）共用，保证两边对“字段”的理解一致。
"""
import re

PROFILE, RATE, SUMMARY, NOTE = "profile", "rate", "summary", "note"

# (规范字段名, 取数层级, 表头别名, 单元格类型 text|num|url)
CATALOG = [
    # 博主层：每个博主一份，行内重复
    ("小红书昵称", PROFILE, ["昵称", "博主昵称", "达人昵称", "博主"], "text"),
    ("ID", PROFILE, ["小红书号", "小红书ID", "红书号"], "text"),
    ("userId", PROFILE, ["博主ID", "蒲公英ID", "蒲公英userId"], "text"),
    ("主页链接", PROFILE, ["博主主页", "博主主页链接", "博主链接", "主页"], "url"),
    ("粉丝量（W）", PROFILE, ["粉丝(W)", "粉丝量W", "粉丝数（W）", "粉丝量（万）", "粉丝（万）"], "num"),
    ("粉丝数", PROFILE, ["粉丝量", "粉丝"], "num"),
    ("图文报价", PROFILE, ["图文价", "图文合作报价"], "num"),
    ("视频报价", PROFILE, ["视频价", "视频合作报价"], "num"),
    # 笔记数据概览层：/blogger/notes-rate，近 30/90 日中位数
    ("曝光中位数", RATE, ["曝光中位", "曝光量中位数"], "num"),
    ("阅读中位数", RATE, ["阅读中位", "阅读量中位数"], "num"),
    ("互动中位数", RATE, ["互动中位", "互动量中位数"], "num"),
    ("点赞中位数", RATE, ["点赞中位", "点赞量中位数"], "num"),
    ("收藏中位数", RATE, ["收藏中位", "收藏量中位数"], "num"),
    ("评论中位数", RATE, ["评论中位", "评论量中位数"], "num"),
    ("转发中位数", RATE, ["分享中位数", "转发中位", "分享中位"], "num"),
    # 成本层：/blogger/data-summary
    ("预估图文CPM", SUMMARY, ["图文CPM", "预估CPM（图文）", "CPM（图文）"], "num"),
    ("预估视频CPM", SUMMARY, ["视频CPM", "预估CPM（视频）", "CPM（视频）"], "num"),
    ("图文阅读单价", SUMMARY, ["预估图文阅读单价", "预估阅读单价（图文）", "阅读单价（图文）"], "num"),
    ("视频阅读单价", SUMMARY, ["预估视频阅读单价", "预估阅读单价（视频）", "阅读单价（视频）"], "num"),
    # 笔记层：一篇笔记一行
    ("笔记标题", NOTE, ["标题", "帖子标题"], "text"),
    ("发布链接", NOTE, ["笔记链接", "帖子链接", "笔记地址", "帖子地址"], "url"),
    ("发布时间", NOTE, ["发布日期", "笔记发布时间"], "text"),
    ("曝光量", NOTE, ["曝光", "曝光数", "笔记曝光"], "num"),
    ("阅读量", NOTE, ["阅读", "阅读数", "笔记阅读"], "num"),
    ("点赞", NOTE, ["点赞量", "点赞数"], "num"),
    ("收藏", NOTE, ["收藏量", "收藏数"], "num"),
    ("评论", NOTE, ["评论量", "评论数"], "num"),
    ("转发", NOTE, ["转发量", "转发数", "分享", "分享量", "转发/分享"], "num"),
    ("总互动", NOTE, ["总互动量", "互动总数", "总互动数"], "num"),
    ("关注", NOTE, ["涨粉", "关注量", "新增关注", "涨粉数"], "num"),
]

# 默认字段，建新表时的默认字段
DEFAULT_FIELDS = [
    "小红书昵称", "ID", "粉丝量（W）", "主页链接", "发布链接", "发布时间",
    "曝光量", "阅读量", "点赞", "收藏", "评论", "转发", "总互动",
]

# 这些笔记层字段必须调 /note/detail 才有（列表接口只给阅读、点赞、收藏、日期）
DETAIL_FIELDS = {"发布链接", "曝光量", "评论", "转发", "总互动", "关注"}

INFO = {name: (level, kind) for name, level, _, kind in CATALOG}
NAMES = [name for name, *_ in CATALOG]


def norm(s):
    """表头比较：半角括号转全角、去空白、转小写。"""
    s = str(s).strip().replace("(", "（").replace(")", "）")
    return re.sub(r"[\s　]+", "", s).lower()


_ALIAS = {}
for _name, _level, _aliases, _kind in CATALOG:
    for _a in [_name] + _aliases:
        _ALIAS.setdefault(norm(_a), _name)


def resolve_field(text):
    """表头或字段名 -> 规范字段名；认不出返回 None。"""
    if text is None:
        return None
    return _ALIAS.get(norm(text))


def level_of(field):
    return INFO[field][0]


def kind_of(field):
    return INFO[field][1]


def col_letter(i):
    """0 基列号 -> A, B, ..., AA"""
    s, i = "", i + 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s
