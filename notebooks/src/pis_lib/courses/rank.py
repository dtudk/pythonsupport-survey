"""Rank scraped courses by how many requirements they fulfil. Copied from courseScraper.

A rule is the points it is worth plus either a regex on a field or a numeric range
(min/max) on it.
"""
import itertools
import re


def field_value(course, key):
    """Look a field up case-insensitively; no key means every text field at once."""
    if key is None:
        return " ".join(v for v in course.values() if isinstance(v, str))
    for field, value in course.items():
        if field.lower() == key.lower():
            return str(value)
    return ""


def rule_hit(course, rule):
    """A rule is a numeric range when it carries min/max, a regex otherwise. A course
    with no number published for the field (blank) never matches a range."""
    value = field_value(course, rule["field"])
    if "min" in rule or "max" in rule:
        if not value.strip().isdigit():
            return False
        number = int(value)
        return rule.get("min", number) <= number <= rule.get("max", number)
    return re.search(rule["pattern"], value, re.I) is not None


def rank(courses, rules):
    for course in courses:
        hits = [rule for rule in rules if rule_hit(course, rule)]
        course["reasons"] = [f"{rule['name']} (+{rule['points']})" for rule in hits]
        course["score"] = sum(rule["points"] for rule in hits)
    return sorted(courses, key=lambda c: (-c["score"], c["code"]))


def print_bins(ranked, out, head):
    """One block per score, highest score first, with only the first `head` courses."""
    for score, courses in itertools.groupby(ranked, key=lambda c: c["score"]):
        courses = list(courses)
        print(f"\n{score} points - {len(courses)} courses", file=out)
        for course in (courses[:head] if head else courses):
            print(f"  {course['code']:<7}{course['name'][:55]:<57}{', '.join(course['reasons'])}", file=out)
        if head and len(courses) > head:
            print(f"  ... {len(courses) - head} more", file=out)
