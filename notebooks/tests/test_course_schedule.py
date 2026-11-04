"""Self-check for schedule compilation; fixed data, no network and no prompting."""
import json
import os
import tempfile

from pis_lib.courses import schedule as compile_schedule

COURSES = [
    {"code": "01001", "name": "Mathematics 1a (Polytechnical foundation)",
     "Language of instruction": "Danish", "schedule_slots": [
        {"slot": "E1A", "day": "Monday", "start": "08:00", "end": "12:00"},
        {"slot": "E2A", "day": "Monday", "start": "13:00", "end": "17:00"},
        {"slot": "E2B", "day": "Thursday", "start": "08:00", "end": "12:00"}]},
    {"code": "01003", "name": "Mathematics 1a (Polytechnical foundation)",
     "Language of instruction": "English", "schedule_slots": [
        {"slot": "E3A", "day": "Tuesday", "start": "08:00", "end": "12:00"}]},
    {"code": "02450", "name": "Introduction to Machine Learning",
     "Language of instruction": "English", "schedule_slots": [
        {"slot": "E7", "day": "Tuesday", "start": "18:00", "end": "22:00"},
        {"slot": "F4A", "day": "Tuesday", "start": "13:00", "end": "17:00"}]},
]

if __name__ == "__main__":
    suffixes = compile_schedule.language_suffixes(COURSES)
    # the two Mathematics 1a courses differ only by language, so both get a tag
    assert suffixes == {"01001": " (DAN)", "01003": " (ENG)"}, suffixes
    # a course whose name nobody shares needs no tag
    assert "02450" not in suffixes

    schedule = compile_schedule.build_schedule(COURSES, {"01001": "Math 1a"}, suffixes)
    assert schedule["Monday"]["morning"][0]["abbreviation"] == "Math 1a (DAN)"
    assert schedule["Tuesday"]["morning"][0]["abbreviation"] == "Mathematics 1a (Polytechnical foundation) (ENG)"
    # a suffix already typed by hand is not repeated
    hand = compile_schedule.build_schedule(COURSES, {"01001": "Math 1a (DAN)"}, suffixes)
    assert hand["Monday"]["morning"][0]["abbreviation"] == "Math 1a (DAN)"

    # a semester keeps only that semester's slots: 02450 holds E7 (autumn) and F4A (spring)
    autumn = compile_schedule.build_schedule(COURSES, {}, {}, "autumn")
    assert [e["number"] for e in autumn["Tuesday"]["afternoon"]] == ["02450"], autumn["Tuesday"]
    assert autumn["Tuesday"]["afternoon"][0]["number"] == "02450"
    spring = compile_schedule.build_schedule(COURSES, {}, {}, "spring")
    assert [e["number"] for e in spring["Monday"]["morning"]] == [], spring["Monday"]

    schedule = compile_schedule.build_schedule(COURSES, {"01001": "Math 1a"}, {})
    assert list(schedule) == ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], list(schedule)
    assert schedule["Monday"]["morning"] == [
        {"abbreviation": "Math 1a", "name": "Mathematics 1a (Polytechnical foundation)", "number": "01001"}]
    assert schedule["Monday"]["afternoon"][0]["abbreviation"] == "Math 1a"
    # no abbreviation stored yet: the full name stands in
    assert schedule["Tuesday"]["afternoon"][0]["abbreviation"] == "Introduction to Machine Learning"
    # E7 (18-22) and F4A (13-17) are both afternoon, and the course is listed once
    assert len(schedule["Tuesday"]["afternoon"]) == 1, schedule["Tuesday"]["afternoon"]
    assert schedule["Wednesday"] == {"morning": [], "afternoon": []}
    assert schedule["Thursday"]["morning"][0]["number"] == "01001"
    # the survey shows only the first 6 per half day, so the best score comes first
    monday = {"slot": "E1A", "day": "Monday", "start": "08:00", "end": "12:00"}
    scored = [dict(COURSES[0], score=1), dict(COURSES[1], score=5, schedule_slots=[monday])]
    ranked = compile_schedule.build_schedule(scored, {}, {})
    assert [e["number"] for e in ranked["Monday"]["morning"]] == ["01003", "01001"], ranked["Monday"]

    # abbreviations are remembered between runs
    path = os.path.join(tempfile.mkdtemp(), "abbreviations.json")
    json.dump({"01001": "Math 1a"}, open(path, "w"))
    store = compile_schedule.collect_abbreviations(COURSES, path, {}, ask=None)
    assert store["01001"] == "Math 1a", store
    assert store["02450"] == "Introduction to Machine Learning", store  # not asked: ask=None
    assert json.load(open(path))["02450"] == "Introduction to Machine Learning"
    # Ctrl-C partway through keeps the answers already given
    path = os.path.join(tempfile.mkdtemp(), "abbreviations.json")
    answers = iter(["Math 1a"])
    try:
        # StopIteration on the second course
        compile_schedule.collect_abbreviations(COURSES, path, {}, ask=lambda prompt: next(answers))
        raise AssertionError("expected the exhausted prompt to raise")
    except StopIteration:
        pass
    assert json.load(open(path)) == {"01001": "Math 1a"}, json.load(open(path))

    print("ok")
