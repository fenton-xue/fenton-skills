#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate a weekly report draft from calendar event JSON."""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable


STAGE_BY_COLOR_ID = {
    "8": "编写用例",
    "9": "初测",
    "10": "复测",
}

STAGE_BY_COLOR_NAME = {
    "石墨黑": "编写用例",
    "graphite": "编写用例",
    "孔雀蓝": "初测",
    "peacock": "初测",
    "鼠尾草绿": "复测",
    "sage": "复测",
}

STAGE_BY_COLOR_HEX = {
    "#e1e1e1": "编写用例",
    "#5484ed": "初测",
    "#51b749": "复测",
}

STAGE_ORDER = ["编写用例", "初测", "复测"]
STAGE_RANK = {stage: index for index, stage in enumerate(STAGE_ORDER)}
PROGRESS_LABEL_BY_STAGE = {
    "编写用例": "编写用例",
    "初测": "UAT",
    "复测": "PRE",
}
WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


@dataclass(frozen=True)
class CalendarEvent:
    summary: str
    stage: str
    start: date
    end: date
    source_index: int


@dataclass(frozen=True)
class ReportRow:
    summary: str
    owner: str
    progress: str
    completion: str
    sort_date: date
    sort_stage: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate weekly report draft.")
    parser.add_argument("--input", help="UTF-8 JSON calendar payload.")
    parser.add_argument("--output", help="Output Markdown/TXT/CSV path.")
    parser.add_argument(
        "--format",
        choices=["auto", "md", "markdown", "text", "csv"],
        default="auto",
        help="Output format. Auto uses .csv suffix when output path ends with .csv.",
    )
    parser.add_argument("--today", help="Override today, format YYYY-MM-DD.")
    parser.add_argument("--owner", help="Override owner column, default from input or 薛丰推.")
    parser.add_argument("--holiday", action="append", default=[], help="Workday holiday YYYY-MM-DD. Repeatable.")
    parser.add_argument("--demo", action="store_true", help="Run with built-in demo data.")
    parser.add_argument("--no-summary", action="store_true", help="Do not include calendar recognition summary.")
    return parser.parse_args()


def parse_date(value: Any) -> date:
    raw = unwrap_datetime_value(value)
    if raw is None:
        raise ValueError("empty date")
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    text = str(raw).strip()
    if not text:
        raise ValueError("empty date")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "T" in text:
        return datetime.fromisoformat(text).date()
    return date.fromisoformat(text[:10])


def unwrap_datetime_value(value: Any) -> Any:
    if isinstance(value, dict):
        return value.get("date") or value.get("dateTime")
    return value


def is_midnight_datetime(value: Any) -> bool:
    raw = unwrap_datetime_value(value)
    if raw is None:
        return False
    text = str(raw).strip()
    if "T" not in text:
        return True
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return False
    return parsed.timetz().replace(tzinfo=None) == time(0, 0)


def is_all_day_exclusive(start_raw: Any, end_raw: Any) -> bool:
    start_value = unwrap_datetime_value(start_raw)
    end_value = unwrap_datetime_value(end_raw)
    if start_value is None or end_value is None:
        return False
    start_text = str(start_value)
    end_text = str(end_value)
    if "T" not in start_text and "T" not in end_text:
        return True
    return is_midnight_datetime(start_raw) and is_midnight_datetime(end_raw)


def normalize_event_dates(raw: dict[str, Any]) -> tuple[date, date]:
    start_raw = raw.get("start")
    end_raw = raw.get("end") or raw.get("finish") or raw.get("end_time") or start_raw
    start = parse_date(start_raw)
    end = parse_date(end_raw)
    if end > start and is_all_day_exclusive(start_raw, end_raw):
        end -= timedelta(days=1)
    if end < start:
        end = start
    return start, end


def normalize_stage(raw: dict[str, Any]) -> str | None:
    explicit_stage = first_present(raw, ["stage", "阶段"])
    if explicit_stage in STAGE_RANK:
        return explicit_stage

    color_id = first_present(raw, ["color_id", "colorId"])
    if color_id is not None and str(color_id) in STAGE_BY_COLOR_ID:
        return STAGE_BY_COLOR_ID[str(color_id)]

    color_value = first_present(raw, ["color", "color_name", "colorName", "颜色"])
    if color_value is None:
        color_value = first_present(
            raw,
            [
                "color_hex",
                "colorHex",
                "background",
                "backgroundColor",
                "background_color",
                "borderColor",
                "css_color",
                "颜色值",
            ],
        )
        if color_value is None:
            return None
    color_text = str(color_value).strip()
    if color_text in STAGE_BY_COLOR_ID:
        return STAGE_BY_COLOR_ID[color_text]
    normalized_hex = normalize_color_hex(color_text)
    return (
        STAGE_BY_COLOR_NAME.get(color_text)
        or STAGE_BY_COLOR_NAME.get(color_text.lower())
        or STAGE_BY_COLOR_HEX.get(normalized_hex)
        or stage_from_color_family(normalized_hex)
    )


def normalize_color_hex(value: str) -> str:
    text = value.strip().lower()
    if text in STAGE_BY_COLOR_HEX:
        return text
    rgb_match = re.search(r"rgba?\(([^)]+)\)", text)
    if rgb_match:
        parts = [part.strip() for part in rgb_match.group(1).split(",")]
        if len(parts) >= 3:
            try:
                red, green, blue = [int(float(part)) for part in parts[:3]]
            except ValueError:
                return text
            return f"#{red:02x}{green:02x}{blue:02x}"
    return text


def stage_from_color_family(hex_color: str) -> str | None:
    if not re.fullmatch(r"#[0-9a-f]{6}", hex_color):
        return None
    red = int(hex_color[1:3], 16)
    green = int(hex_color[3:5], 16)
    blue = int(hex_color[5:7], 16)
    spread = max(red, green, blue) - min(red, green, blue)
    brightness = (red + green + blue) / 3

    # Google Calendar dims past events. Classify by channel relationship so darker
    # variants of the same event color keep the original stage.
    if spread <= 35:
        return "编写用例"
    if blue >= green + 20 and blue >= red + 20:
        return "初测"
    if green >= red + 15 and green >= blue + 15:
        return "复测"
    if brightness <= 110 and spread <= 55:
        return "编写用例"
    return None


def first_present(raw: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        value = raw.get(key)
        if value not in (None, ""):
            return value
    return None


def event_title(raw: dict[str, Any]) -> str:
    title = first_present(raw, ["summary", "title", "display_title", "name"])
    return str(title).strip() if title is not None else ""


def load_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.demo:
        return demo_payload()
    if not args.input:
        raise SystemExit("--input is required unless --demo is used")
    if args.input == "-":
        payload = json.load(sys.stdin)
    else:
        with Path(args.input).open("r", encoding="utf-8") as file:
            payload = json.load(file)
    if isinstance(payload, list):
        return {"events": payload}
    if not isinstance(payload, dict):
        raise SystemExit("Input JSON must be an object or a list of events")
    return payload


def parse_calendar_events(raw_events: list[Any]) -> tuple[list[CalendarEvent], list[str]]:
    events: list[CalendarEvent] = []
    warnings: list[str] = []
    for index, item in enumerate(raw_events, start=1):
        if not isinstance(item, dict):
            warnings.append(f"第 {index} 条事件不是对象，已跳过")
            continue
        summary = event_title(item)
        if not summary:
            warnings.append(f"第 {index} 条事件缺少标题，已跳过")
            continue
        stage = normalize_stage(item)
        if stage is None:
            warnings.append(f"{summary}: 缺少可识别的颜色/阶段，已跳过")
            continue
        try:
            start, end = normalize_event_dates(item)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"{summary}: 日期解析失败（{exc}），已跳过")
            continue
        events.append(CalendarEvent(summary=summary, stage=stage, start=start, end=end, source_index=index))
    return events, warnings


def week_bounds(day: date, offset_weeks: int = 0) -> tuple[date, date]:
    monday = day - timedelta(days=day.weekday()) + timedelta(days=offset_weeks * 7)
    return monday, monday + timedelta(days=4)


def iter_days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def is_workday(day: date, holidays: set[date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def count_workdays(start: date, end: date, holidays: set[date]) -> int:
    if end < start:
        return 0
    return sum(1 for day in iter_days(start, end) if is_workday(day, holidays))


def has_workday_overlap(event: CalendarEvent, start: date, end: date, holidays: set[date]) -> bool:
    overlap_start = max(event.start, start)
    overlap_end = min(event.end, end)
    return count_workdays(overlap_start, overlap_end, holidays) > 0


def round_to_nearest_ten_percent(done: int, total: int) -> int:
    if total <= 0:
        return 0
    value = (Decimal(done) * Decimal(100)) / Decimal(total)
    rounded_tens = (value / Decimal(10)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return max(0, min(100, int(rounded_tens * 10)))


def progress_percent(event: CalendarEvent, week_end: date, holidays: set[date]) -> int:
    if event.end <= week_end:
        return 100
    total = count_workdays(event.start, event.end, holidays)
    done = count_workdays(event.start, min(event.end, week_end), holidays)
    return round_to_nearest_ten_percent(done, total)


def group_by_summary(events: list[CalendarEvent]) -> dict[str, list[CalendarEvent]]:
    grouped: dict[str, list[CalendarEvent]] = {}
    for event in events:
        grouped.setdefault(event.summary, []).append(event)
    return grouped


def release_cell(
    summary: str,
    events_by_summary: dict[str, list[CalendarEvent]],
    today: date,
    holidays: set[date],
    horizon_end: date,
) -> tuple[str, bool, str | None]:
    retests = [event for event in events_by_summary.get(summary, []) if event.stage == "复测"]
    completed_retests = [event for event in retests if event.end <= horizon_end]
    if not completed_retests:
        if retests:
            return "", False, f"{summary}: 复测未在下下周周五前结束，完成时间留空"
        return "", False, f"{summary}: 未在当前查询窗口内找到复测活动，完成时间留空"

    retest_end = max(event.end for event in completed_retests)
    release_week_start, release_week_end = week_bounds(retest_end)
    holiday_hits = sorted(day for day in holidays if release_week_start <= day <= release_week_end and day.weekday() < 5)
    if holiday_hits:
        dates = "、".join(format_date_dot(day) for day in holiday_hits)
        return "", False, f"{summary}: 复测结束周存在工作日节假日（{dates}），完成时间留空"

    release = release_week_start + timedelta(days=3)
    if release <= today:
        return f"上线时间：{format_date_dot(release)}", True, None
    return f"预计上线时间: {format_date_dot(release)}", False, None


def build_week_rows(
    events: list[CalendarEvent],
    week_start: date,
    week_end: date,
    owner: str,
    today: date,
    holidays: set[date],
    horizon_end: date,
) -> tuple[list[ReportRow], list[str]]:
    events_by_summary = group_by_summary(events)
    week_events = [event for event in events if has_workday_overlap(event, week_start, week_end, holidays)]
    grouped = group_by_summary(week_events)
    warnings: list[str] = []
    rows: list[ReportRow] = []

    for summary, requirement_events in grouped.items():
        best_by_stage: dict[str, int] = {}
        for event in requirement_events:
            percent = progress_percent(event, week_end, holidays)
            current = best_by_stage.get(event.stage)
            if current is None or percent > current:
                best_by_stage[event.stage] = percent
        progress = "、".join(
            f"{PROGRESS_LABEL_BY_STAGE[stage]}:{best_by_stage[stage]}%" for stage in STAGE_ORDER if stage in best_by_stage
        )
        completion, released, warning = release_cell(summary, events_by_summary, today, holidays, horizon_end)
        if released:
            progress = "已上线"
        if warning:
            warnings.append(warning)
        earliest = min(event.start for event in requirement_events)
        earliest_stage = min(STAGE_RANK[event.stage] for event in requirement_events)
        rows.append(
            ReportRow(
                summary=summary,
                owner=owner,
                progress=progress,
                completion=completion,
                sort_date=earliest,
                sort_stage=earliest_stage,
            )
        )

    rows.sort(key=lambda row: (row.sort_date, row.sort_stage, row.summary))
    return rows, warnings


def build_biweekly_plan(
    events: list[CalendarEvent],
    next_start: date,
    next_next_end: date,
    owner: str,
    holidays: set[date],
) -> str:
    candidates = [
        event
        for event in events
        if event.stage in {"初测", "复测"} and has_workday_overlap(event, next_start, next_next_end, holidays)
    ]
    grouped = group_by_summary(candidates)
    if not grouped:
        return f"{owner}: 暂无初测/复测安排"

    items: list[tuple[date, str, str]] = []
    for summary, requirement_events in grouped.items():
        stages = [stage for stage in ["初测", "复测"] if any(event.stage == stage for event in requirement_events)]
        earliest = min(event.start for event in requirement_events)
        items.append((earliest, summary, f"{summary}({'+'.join(stages)})"))
    items.sort(key=lambda item: (item[0], item[1]))
    return f"{owner}: 主要测试" + ", ".join(item for *_unused, item in items)


def build_calendar_summary(events: list[CalendarEvent], today: date, holidays: set[date]) -> list[str]:
    lines = [f"今天是{today.year}/{today.month}/{today.day} {WEEKDAY_CN[today.weekday()]}，查看日历发现:"]
    labels = [("本周", 0), ("下周", 1), ("下下周", 2)]
    for label, offset in labels:
        week_start, week_end = week_bounds(today, offset)
        lines.append(f"{label}: {format_date_short(week_start)}-{format_date_short(week_end)}")
        week_events = [event for event in events if has_workday_overlap(event, week_start, week_end, holidays)]
        week_events.sort(key=lambda event: (event.start, STAGE_RANK[event.stage], event.summary))
        if not week_events:
            lines.append("（无）")
            continue
        for index, event in enumerate(week_events, start=1):
            ended = event.end <= week_end
            suffix = f"{event.stage}结束" if ended else f"{event.stage}, 未结束"
            lines.append(f"{index}. {event.summary} - {suffix}")
    return lines


def render_report(
    events: list[CalendarEvent],
    today: date,
    owner: str,
    holidays: set[date],
    include_summary: bool,
    parse_warnings: list[str],
) -> str:
    this_start, this_end = week_bounds(today, 0)
    next_start, next_end = week_bounds(today, 1)
    _next_next_start, next_next_end = week_bounds(today, 2)

    lines: list[str] = []

    if include_summary:
        lines.extend(build_calendar_summary(events, today, holidays))
        lines.append("")

    current_rows, _current_warnings = build_week_rows(events, this_start, this_end, owner, today, holidays, next_next_end)
    next_rows, _next_warnings = build_week_rows(events, next_start, next_end, owner, today, holidays, next_next_end)

    lines.append("一. 本周工作内容")
    lines.extend([format_report_row(row) for row in current_rows] or ["（无）"])
    lines.append("")
    lines.append("二. 下周工作计划")
    lines.extend([format_report_row(row) for row in next_rows] or ["（无）"])
    lines.append("")
    lines.append("三. 双周计划")
    lines.append(build_biweekly_plan(events, next_start, next_next_end, owner, holidays))

    return "\n".join(lines) + "\n"


def render_csv_report(
    events: list[CalendarEvent],
    today: date,
    owner: str,
    holidays: set[date],
    include_summary: bool,
    parse_warnings: list[str],
) -> str:
    this_start, this_end = week_bounds(today, 0)
    next_start, next_end = week_bounds(today, 1)
    _next_next_start, next_next_end = week_bounds(today, 2)

    current_rows, _current_warnings = build_week_rows(events, this_start, this_end, owner, today, holidays, next_next_end)
    next_rows, _next_warnings = build_week_rows(events, next_start, next_end, owner, today, holidays, next_next_end)

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")

    if include_summary:
        writer.writerow(["日历识别结果"])
        for line in build_calendar_summary(events, today, holidays):
            writer.writerow([line])
        writer.writerow([])

    write_week_csv_section(writer, "一. 本周工作内容", current_rows)
    writer.writerow([])
    write_week_csv_section(writer, "二. 下周工作计划", next_rows)
    writer.writerow([])
    writer.writerow(["三. 双周计划"])
    writer.writerow(["内容"])
    writer.writerow([build_biweekly_plan(events, next_start, next_next_end, owner, holidays)])

    return output.getvalue()


def collect_report_warnings(
    events: list[CalendarEvent],
    today: date,
    owner: str,
    holidays: set[date],
    parse_warnings: list[str],
) -> list[str]:
    this_start, this_end = week_bounds(today, 0)
    next_start, next_end = week_bounds(today, 1)
    _next_next_start, next_next_end = week_bounds(today, 2)
    warnings: list[str] = list(parse_warnings)
    _current_rows, current_warnings = build_week_rows(events, this_start, this_end, owner, today, holidays, next_next_end)
    _next_rows, next_warnings = build_week_rows(events, next_start, next_end, owner, today, holidays, next_next_end)
    warnings.extend(current_warnings)
    warnings.extend(next_warnings)
    return sorted(set(warnings))


def emit_warnings(warnings: list[str]) -> None:
    if not warnings:
        return
    print("以下内容需要手动补充或确认：", file=sys.stderr)
    for warning in warnings:
        print(f"- {warning}", file=sys.stderr)


def write_week_csv_section(writer: csv.writer, title: str, rows: list[ReportRow]) -> None:
    writer.writerow([title])
    writer.writerow(["需求名称", "负责人", "进度", "（预计）完成时间"])
    if not rows:
        writer.writerow(["（无）", "", "", ""])
        return
    for row in rows:
        writer.writerow([row.summary, row.owner, row.progress, row.completion])


def format_report_row(row: ReportRow) -> str:
    return f"| {row.summary} | {row.owner} | {row.progress} | {row.completion} |"


def resolve_output_format(args: argparse.Namespace) -> str:
    if args.format in {"md", "markdown", "text"}:
        return "text"
    if args.format == "csv":
        return "csv"
    if args.output and Path(args.output).suffix.lower() == ".csv":
        return "csv"
    return "text"


def parse_holidays(payload: dict[str, Any], cli_holidays: list[str]) -> set[date]:
    holidays: set[date] = set()
    for value in payload.get("holidays", []) or []:
        holidays.add(parse_date(value))
    for value in cli_holidays:
        holidays.add(parse_date(value))
    return holidays


def format_date_dot(day: date) -> str:
    return day.strftime("%Y.%m.%d")


def format_date_short(day: date) -> str:
    return f"{day.month}.{day.day}"


def demo_payload() -> dict[str, Any]:
    return {
        "today": "2026-05-29",
        "owner": "薛丰推",
        "events": [
            {
                "summary": "#61886 【SOX】3PL FW订单线上化二期",
                "start": "2026-05-25T00:00:00",
                "end": "2026-05-28T00:00:00",
                "color_id": "10",
            },
            {
                "summary": "#89608 海运系统消息中心搭建",
                "start": "2026-05-25T00:00:00",
                "end": "2026-05-30T00:00:00",
                "color_id": "8",
            },
            {
                "summary": "#89608 海运系统消息中心搭建",
                "start": "2026-06-02T00:00:00",
                "end": "2026-06-06T00:00:00",
                "color_id": "9",
            },
            {
                "summary": "#89608 海运系统消息中心搭建",
                "start": "2026-06-08T00:00:00",
                "end": "2026-06-16T00:00:00",
                "color_id": "10",
            },
            {
                "summary": "#88709 自营业务中涉及【购买海运保险】字段更名为【海运保障服务】",
                "start": "2026-05-25T00:00:00",
                "end": "2026-05-30T00:00:00",
                "color_id": "9",
            },
            {
                "summary": "#88709 自营业务中涉及【购买海运保险】字段更名为【海运保障服务】",
                "start": "2026-06-01T00:00:00",
                "end": "2026-06-05T00:00:00",
                "color_id": "10",
            },
            {
                "summary": "#131002 【联测】CMS和DI迁移OHUB",
                "start": "2026-05-29T00:00:00",
                "end": "2026-05-30T00:00:00",
                "color_id": "8",
            },
            {
                "summary": "#131002 【联测】CMS和DI迁移OHUB",
                "start": "2026-06-03T00:00:00",
                "end": "2026-06-13T00:00:00",
                "color_id": "9",
            },
        ],
    }


def main() -> None:
    args = parse_args()
    payload = load_payload(args)
    raw_events = payload.get("events") or []
    if not isinstance(raw_events, list):
        raise SystemExit("Input JSON field 'events' must be a list")

    today = parse_date(args.today or payload.get("today") or date.today())
    owner = args.owner or payload.get("owner") or "薛丰推"
    holidays = parse_holidays(payload, args.holiday)
    events, parse_warnings = parse_calendar_events(raw_events)
    if resolve_output_format(args) == "csv":
        report = render_csv_report(
            events=events,
            today=today,
            owner=owner,
            holidays=holidays,
            include_summary=not args.no_summary,
            parse_warnings=parse_warnings,
        )
    else:
        report = render_report(
            events=events,
            today=today,
            owner=owner,
            holidays=holidays,
            include_summary=not args.no_summary,
            parse_warnings=parse_warnings,
        )

    warnings = collect_report_warnings(events, today, owner, holidays, parse_warnings)
    emit_warnings(warnings)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report, encoding="utf-8")
    else:
        print(report, end="")


if __name__ == "__main__":
    main()
