"""Lay the top-ranked courses out as frontend/data/courseSchedule.json. Copied from courseScraper.

Shape: weekday -> morning / afternoon -> [{abbreviation, name, number}]. Abbreviations are
asked for once and remembered in a JSON file.
"""
import collections
import json
import os
import sys

from . import rank, scrape

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
LANGUAGE_TAGS = {"Danish": "DAN", "English": "ENG"}


def language_suffixes(courses):
    """ (DAN)/(ENG) for a course that shares its name with one taught in another language,
    so the two are told apart the way the reference schedule does it."""
    by_name = collections.defaultdict(list)
    for course in courses:
        by_name[course["name"]].append(course)
    suffixes = {}
    for group in by_name.values():
        tags = {c["code"]: LANGUAGE_TAGS.get(c.get("Language of instruction", ""), "") for c in group}
        if len(set(tags.values())) > 1:
            suffixes.update({code: f" ({tag})" for code, tag in tags.items() if tag})
    return suffixes


def build_schedule(courses, abbreviations, suffixes, semester=None):
    """A semester keeps only that semester's slots, so a course taught in both is laid
    out where it actually runs rather than in both places at once. Each half day lists the
    best-scoring courses first: the survey shows only the first 6."""
    schedule = {day: {"morning": [], "afternoon": []} for day in DAYS}
    for course in sorted(courses, key=lambda c: (-c.get("score", 0), c["code"])):
        abbreviation = abbreviations.get(course["code"], course["name"])
        suffix = suffixes.get(course["code"], "")
        if suffix and suffix.strip() not in abbreviation:  # don't repeat a suffix typed by hand
            abbreviation += suffix
        entry = {"abbreviation": abbreviation, "name": course["name"], "number": course["code"]}
        for slot in course.get("schedule_slots", []):
            if semester and scrape.SEASONS[slot["slot"][0]] != semester.title():
                continue
            if slot["day"] in schedule:
                # the format has no evening, so the 18-22 slot lands in the afternoon
                half = "morning" if slot["start"] < "12:00" else "afternoon"
                bucket = schedule[slot["day"]][half]
                if entry not in bucket:  # a course can hold the same half of a day twice
                    bucket.append(entry)
    return schedule


def collect_abbreviations(courses, path, suffixes, ask=input):
    """Ask once per course number, then reuse the answer on later runs. An empty answer, or
    ask=None, keeps the full name."""
    store = json.load(open(path)) if os.path.exists(path) else {}
    missing = [c for c in sorted(courses, key=lambda c: c["code"]) if c["code"] not in store]
    try:
        for course in missing:
            suffix = suffixes.get(course["code"], "")
            hint = f" [{suffix.strip()} added automatically]" if suffix else ""
            answer = ask(f"Abbreviation for {course['code']} {course['name']}{hint}: ").strip() if ask else ""
            store[course["code"]] = answer or course["name"]
    finally:
        if missing:  # an interrupt mid-way still keeps the answers already given
            json.dump(store, open(path, "w"), indent=2, ensure_ascii=False, sort_keys=True)
    return store


def compile_schedule(courses, rules, abbreviations_path, semester, min_score, ask=input):
    """Courses scoring at least min_score that have a slot in the semester."""
    ranked = [c for c in rank.rank(courses, rules) if c["score"] >= min_score]
    scheduled = [c for c in ranked if c.get("schedule_slots") and semester.title() in c.get("semesters", [])]
    if len(scheduled) < len(ranked):
        print(f"{len(ranked) - len(scheduled)} courses have no {semester} slot and are left out", file=sys.stderr)
    suffixes = language_suffixes(scheduled)
    abbreviations = collect_abbreviations(scheduled, abbreviations_path, suffixes, ask)
    return build_schedule(scheduled, abbreviations, suffixes, semester)


def dump_schedule(schedule):
    """One line per course."""
    days = []
    for day, halves in schedule.items():
        parts = []
        for half, entries in halves.items():
            rows = ",\n".join("      " + json.dumps(e, ensure_ascii=False) for e in entries)
            parts.append(f'    "{half}": [\n{rows}\n    ]' if entries else f'    "{half}": []')
        days.append(f'  "{day}": {{\n' + ",\n".join(parts) + "\n  }")
    return "{\n" + ",\n".join(days) + "\n}\n"


def write_schedule(schedule, path):
    open(path, "w").write(dump_schedule(schedule))
