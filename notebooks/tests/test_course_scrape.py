"""Self-check: parse a saved course page and assert the fields we care about."""
import datetime
import io

import requests

from pis_lib.courses import scrape


def check_progress():
    out = io.StringIO()  # not a tty, so no redraw thread and no escape codes
    p = scrape.Progress(10, stream=out)
    p.start -= 5  # pretend 5 seconds have passed
    p.active = {"ThreadPoolExecutor-0_3": "02450", "ThreadPoolExecutor-0_1": "01001"}
    p.done, p.skipped = 4, 1
    lines = p.lines()
    assert lines[0].startswith("Courses:           4 / 10, 40%, 0.8/s, ETA 7s"), lines[0]
    assert lines[1].strip() == "Skipped:           1", lines[1]
    assert lines[2].strip() == "Elapsed time:     5s", lines[2]
    assert lines[3].strip() == f"Workers:      2 / {scrape.WORKERS} busy", lines[3]
    assert lines[4:] == ["  * worker 1: 01001", "  * worker 3: 02450"], lines[4:]
    p.tick("02450", found=True)
    assert "[5/10] 02450" in out.getvalue(), out.getvalue()
    p.tick("99999", found=False)
    assert "(skipped)" in out.getvalue()
    assert (p.done, p.skipped) == (6, 2)
    p.tick("02002", found=False, error="02002: Read timed out")
    assert "1 failed" in p.lines()[1], p.lines()[1]
    p.close()
    assert out.getvalue().endswith("failed 02002: Read timed out\n"), out.getvalue()
    assert scrape.human(3671) == "1h1m11s" and scrape.human(95) == "1m35s" and scrape.human(9) == "9s"
    # only finished exam periods, newest first, and only last year's two
    assert scrape.finished_semesters(datetime.date(2026, 9, 22)) == ["Summer-2026", "Winter-2025"]
    assert scrape.finished_semesters(datetime.date(2026, 1, 15)) == ["Summer-2025", "Winter-2024"]
    # December's winter exams have no numbers yet, so last year's winter period counts
    assert scrape.finished_semesters(datetime.date(2026, 12, 31)) == ["Summer-2026", "Winter-2025"]
    assert scrape.finished_semesters(datetime.date(2027, 2, 1)) == ["Winter-2026", "Summer-2026"]
    assert scrape.finished_semesters(datetime.date(2027, 7, 31)) == ["Winter-2026", "Summer-2026"]

    assert scrape.semesters([{"slot": "E4A"}, {"slot": "E1B"}]) == ["Autumn"]
    assert scrape.semesters([{"slot": "F4A"}, {"slot": "E4A"}]) == ["Autumn", "Spring"]
    assert scrape.semesters([]) == []  # three-week courses hold no weekly slot

    codes = ["01001", "02450", "02999", "MA722"]
    assert scrape.select_range(codes, "02000-02999") == ["02450", "02999"]
    assert scrape.select_range(codes, None) == codes  # no range means every code
    print("progress ok")


def check_enrolment_failure():
    """A course page that loaded is kept when karakterer.dtu.dk fails, and the failure is listed."""
    class Page:
        text = '<div id="pagecontents"><h2>02002 Computer Programming</h2></div>'

    class Session:
        def get(self, url):
            if url.startswith(scrape.GRADES):
                raise requests.ConnectionError("karakterer.dtu.dk is down")
            return Page()

    original, scrape.thread_session = scrape.thread_session, lambda language: Session()
    try:
        progress = scrape.Progress(1, stream=io.StringIO())
        course = scrape.fetch("02002", {}, progress, "en-GB", ["Summer-2026"])
    finally:
        scrape.thread_session = original
    assert course["name"] == "Computer Programming" and "enrolled" not in course, course
    assert progress.failures == ["02002 enrolment: karakterer.dtu.dk is down"], progress.failures
    print("enrolment failure ok")


if __name__ == "__main__":
    check_progress()
    check_enrolment_failure()
    s = scrape.session()
    course = scrape.parse(s.get("https://kurser.dtu.dk/course/2024-2025/02450").text, "02450")
    assert course["name"] == "Introduction to Machine Learning and Data Mining", course["name"]
    assert course["Language of instruction"] == "English"
    assert course["Schedule"].startswith("Spring F4A"), course["Schedule"]
    assert course["Content"].startswith("Structured data modelling"), course["Content"][:100]
    assert course["General course objectives"].startswith("To provide"), course["General course objectives"][:60]
    known = scrape.departments(s)
    # the form submits values that differ from the numbers it displays
    assert known["56"][0] == "59" and known["56"][1] == "DTU Nanolab", known["56"]
    assert known["62"][0] == "IHK", known["62"]
    assert known["01"][0] == "1", known["01"]
    assert len(known) > 20, len(known)
    nanolab = scrape.course_codes(s, ["56"])
    assert 0 < len(nanolab) < len(scrape.course_codes(s)), len(nanolab)

    grid = scrape.slot_grid(s)
    assert grid["E1A"] == {"day": "Monday", "start": "08:00", "end": "12:00"}, grid["E1A"]
    assert grid["F5B"] == {"day": "Wednesday", "start": "13:00", "end": "17:00"}, grid["F5B"]
    assert grid["E7"] == {"day": "Tuesday", "start": "18:00", "end": "22:00"}, grid["E7"]
    assert "Pause" not in grid
    assert scrape.schedule_slots("Spring F4A (Tues 13-17) Autumn E4A", grid) == [
        {"slot": "F4A", "day": "Tuesday", "start": "13:00", "end": "17:00"},
        {"slot": "E4A", "day": "Tuesday", "start": "13:00", "end": "17:00"},
    ]
    # a bare slot means both halves, and repeats collapse
    assert [s["slot"] for s in scrape.schedule_slots("Scheme A: E1A, E2, E2", grid)] == ["E1A", "E2A", "E2B"]
    assert scrape.schedule_slots("January, 3 week period", grid) == []

    semesters = scrape.finished_semesters()
    signed_up = scrape.enrolment(s, "01001", semesters)
    assert signed_up["enrolled"] > 100, signed_up  # 01001 is a first-year course
    assert signed_up["enrolled_semester"] in semesters, signed_up
    assert scrape.enrolment(s, "99999", semesters) == {}  # no such course

    codes = scrape.course_codes(s)
    assert len(codes) > 1000 and "01001" in codes, len(codes)
    print(f"ok, {len(codes)} course codes")
