"""Scrape DTU course data from kurser.dtu.dk. Copied from courseScraper, without its command line."""
import datetime
import functools
import json
import os
import re
import sys
import threading
import time
from html import unescape

import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://kurser.dtu.dk"
GRADES = "https://karakterer.dtu.dk"
SEASONS = {"E": "Autumn", "F": "Spring"}  # DTU slot codes: E for efterår, F for forår
WORKERS = 8  # concurrent requests; kurser.dtu.dk is a shared service, keep this modest
DEPARTMENT_OPTIONS = re.compile(r'<select[^>]*name="Department".*?</select>', re.S)


def session(language="en-GB"):
    """kurser.dtu.dk serves a stub page until a login attempt has seeded the session."""
    s = requests.Session()
    # the site sometimes accepts a connection and then goes quiet, which hangs a worker
    # for good; requests has no default timeout, so give every call one
    s.request = functools.partial(s.request, timeout=30)
    retries = requests.adapters.Retry(total=3, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
    s.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=WORKERS, max_retries=retries))
    s.headers["User-Agent"] = "Mozilla/5.0 (course scraper)"
    s.cookies.set("{DTUCoursesPublicLanguage}", language, domain="kurser.dtu.dk")
    s.get(f"{BASE}/course/01001")
    s.get(f"{BASE}/course/01001?forceLogin=true", allow_redirects=False)
    s.post(f"{BASE}/unsetLanguage")
    return s


def departments(s):
    """Department number -> (form value, name), read off the search form.

    The form submits values that differ from the numbers it shows: 56 DTU Nanolab is
    submitted as 59, and 62 Engineering Technology and Didactics as IHK.
    """
    block = DEPARTMENT_OPTIONS.search(s.get(f"{BASE}/search").text).group(0)
    known = {}
    for value, label in re.findall(r'<option value="([^"]*)"[^>]*>([^<]*)</option>', block):
        number, _, name = unescape(label).strip().partition(" ")
        known[number] = (value, name.strip())
    return known


def search_codes(s, values):
    """Course codes listed for these department form values, in one request."""
    html = s.get(f"{BASE}/search", params={"Department": values}).text
    return set(re.findall(r'href="/course/(\w+)"', html)) - {"gotoStudyplanner"}


def course_codes(s, chosen=None):
    known = departments(s)
    unknown = [number for number in chosen or [] if number not in known]
    if unknown:
        sys.exit(f"no such department: {', '.join(unknown)}. Known: {', '.join(sorted(known))}")
    wanted = chosen or sorted(known)
    print(f"Listing courses from {len(wanted)} departments...", file=sys.stderr)
    return sorted(search_codes(s, [known[number][0] for number in wanted]))


def text(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def parse(html, code):
    soup = BeautifulSoup(html, "html.parser")
    page = soup.find(id="pagecontents")
    if page is None:
        return None
    course = {"code": code, "url": f"{BASE}/course/{code}"}
    heading = page.find("h2")
    course["name"] = text(heading).split(" ", 1)[-1] if heading else ""
    # info box: <td><label>Key</label></td><td>Value</td>
    for label in page.find_all("label"):
        row = label.find_parent("tr")
        if row and len(row.find_all("td")) == 2:
            course[text(label)] = text(row.find_all("td")[1])
    # free-text sections: <div class="bar">Heading</div> then siblings up to the next bar
    for bar in page.select("div.bar"):
        if "information" in text(bar).lower():
            continue
        body = []
        for node in bar.next_siblings:
            if getattr(node, "get", lambda _: None)("class") == ["bar"]:
                break
            body.append(node if isinstance(node, str) else text(node))
        course[text(bar)] = re.sub(r"\s+", " ", " ".join(body)).strip()
    return course


def slot_grid(s):
    """Map each schedule slot (E1A, F4B, ...) to its weekday and hours.

    The grid is the same for every course, so any course's schedule page will do.
    """
    soup = BeautifulSoup(s.get(f"{BASE}/schedule/01001").text, "html.parser")
    grid = {}
    for table in soup.select("table"):
        days = [text(th) for th in table.select("thead th")][1:]
        for row in table.select("tbody tr"):
            cells = row.find_all("td")
            if len(cells) != len(days) + 1:
                continue  # break rows span the full width
            start, end = re.findall(r"\d+", text(cells[0]))
            for day, cell in zip(days, cells[1:]):
                for slot in text(cell).split():
                    grid[slot] = {"day": day, "start": f"{int(start):02d}:00", "end": f"{int(end):02d}:00"}
    return grid


def schedule_slots(schedule, grid):
    """Turn a Schedule string ("Autumn E1A, E2") into weekday/time entries."""
    slots = []
    for code in re.findall(r"\b[EF]\d[AB]?\b", schedule or ""):
        # a slot without the A/B half, e.g. E2, means both halves
        for name in [code] if code in grid else [code + "A", code + "B"]:
            if name in grid and not any(s["slot"] == name for s in slots):
                slots.append({"slot": name, **grid[name]})
    return slots


def semesters(slots):
    """Which semesters a course runs in, read off its slot codes (E4A -> Autumn)."""
    return sorted({SEASONS[slot["slot"][0]] for slot in slots})


def human(seconds):
    """1234 -> 20m34s, in rclone's style."""
    minutes, seconds = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}h{minutes}m{seconds}s"
    return f"{minutes}m{seconds}s" if minutes else f"{seconds}s"


class Progress:
    """Live status block on stderr: counters, rate, ETA and what each worker is on.

    Falls back to one line per course when stderr is not a terminal, so logs stay readable.
    """

    def __init__(self, total, stream=sys.stderr):
        self.total, self.stream = total, stream
        self.done = self.skipped = self.drawn = 0
        self.failures = []  # "code: error", listed when the run ends
        self.active = {}  # worker thread name -> course code being fetched
        self.start = time.monotonic()
        self.live = stream.isatty()
        self.stopped = threading.Event()
        if self.live:
            threading.Thread(target=self._redraw_loop, daemon=True).start()

    def _redraw_loop(self):
        while not self.stopped.wait(0.5):  # keep the clock moving even while requests hang
            self.draw()

    def working_on(self, code):
        self.active[threading.current_thread().name] = code

    def idle(self):
        self.active.pop(threading.current_thread().name, None)

    def tick(self, code, found, error=False):
        self.done += 1
        self.skipped += not found
        if error:
            self.failures.append(error)
        if not self.live:
            print(f"[{self.done}/{self.total}] {code}" + ("" if found else " (skipped)"), file=self.stream)

    def lines(self):
        elapsed = time.monotonic() - self.start
        rate = self.done / elapsed if elapsed else 0
        left = self.total - self.done
        eta = human(left / rate) if rate and left else "-"
        percent = self.done * 100 // self.total if self.total else 0
        block = [
            f"Courses:      {self.done:>6} / {self.total}, {percent}%, {rate:.1f}/s, ETA {eta}",
            f"Skipped:      {self.skipped:>6}" + (f", {len(self.failures)} failed" if self.failures else ""),
            f"Elapsed time: {human(elapsed):>6}",
            f"Workers:      {len(self.active)} / {WORKERS} busy",
        ]
        # ThreadPoolExecutor names its threads ThreadPoolExecutor-0_3; keep the trailing number
        return block + [f"  * worker {name.rsplit('_', 1)[-1]}: {code}"
                        for name, code in sorted(self.active.items())]

    def draw(self):
        if not self.live:
            return
        up = f"\x1b[{self.drawn}A" if self.drawn else ""
        block = "\n".join(self.lines())
        self.stream.write(f"{up}\r{block}\n\x1b[J")  # \x1b[J wipes lines left by fewer workers
        self.stream.flush()
        self.drawn = block.count("\n") + 1

    def close(self):
        self.stopped.set()
        self.draw()
        for failure in self.failures:
            print(f"failed {failure}", file=self.stream)


_local = threading.local()


def thread_session(language):
    """One session per thread: the server serializes requests that share a session cookie,
    so sharing one would undo the thread pool."""
    if not hasattr(_local, "session"):
        _local.session = session(language)
    return _local.session


def fetch(code, grid, progress, language, exam_periods):
    progress.working_on(code)
    try:
        s = thread_session(language)
        html = s.get(f"{BASE}/course/{code}").text
        if "pagecontents" not in html:
            # not offered this year: fall back to the newest archived volume
            volumes = re.findall(rf'href="/course/(\d{{4}}-\d{{4}})/{code}"', html)
            if volumes:
                html = s.get(f"{BASE}/course/{volumes[-1]}/{code}").text
        course = parse(html, code)
        if course:
            course["schedule_slots"] = schedule_slots(course.get("Schedule"), grid)
            course["semesters"] = semesters(course["schedule_slots"])
            try:
                course.update(enrolment(s, code, exam_periods))
            except requests.RequestException as error:  # keep the course, without its enrolment points
                progress.failures.append(f"{code} enrolment: {error}")
        return course
    finally:
        progress.idle()


def finished_semesters(today=None):
    """Newest finished exam period first. Summer exams run in May and June, winter exams in
    December, and karakterer.dtu.dk has no numbers until the results are out: a period
    counts from August (summer) or February (winter)."""
    today = today or datetime.date.today()
    periods = [(year, season) for year in range(today.year, today.year - 3, -1) for season in ("Winter", "Summer")]
    finished = [f"{season}-{year}" for year, season in sorted(periods, reverse=True)
                if ((year + 1, 2) if season == "Winter" else (year, 8)) <= (today.year, today.month)]
    return finished[:2]  # the last academic year: one summer period and one winter period


def enrolment(s, code, periods):
    """Students signed up, from last year's exam periods. Both are checked and the
    bigger one wins: the period after the course ran is the real cohort, the other one
    is a re-exam sitting. The period a course is running in has no numbers yet."""
    counts = {}
    for period in periods:
        response = s.get(f"{GRADES}/Histogram/1/{code}/{period}")
        if response.status_code != 200:
            continue
        for row in BeautifulSoup(response.text, "html.parser").select("tr"):
            cells = row.find_all("td")
            if len(cells) == 2 and "Antal tilmeldte" in text(cells[0]):
                counts[period] = int(text(cells[1]))
    if not counts:
        return {}
    period = max(counts, key=counts.get)
    return {"enrolled": counts[period], "enrolled_semester": period}


def select_range(codes, code_range):
    """Keep the codes inside FIRST-LAST, e.g. 02000-02999. Codes compare as text,
    so a range of digits leaves lettered codes such as MA722 out."""
    if not code_range:
        return codes
    first, _, last = code_range.partition("-")
    return [c for c in codes if first <= c <= last]


def scrape(codes=None, language="en-GB", workers=WORKERS, code_range=None, semester=None,
           chosen_departments=None):
    s = session(language)
    grid = slot_grid(s)
    codes = select_range(codes or course_codes(s, chosen_departments), code_range)
    pool = ThreadPoolExecutor(workers)
    progress = Progress(len(codes))
    try:
        exam_periods = finished_semesters()
        pending = {pool.submit(fetch, code, grid, progress, language, exam_periods): code for code in codes}
        for future in as_completed(pending):
            code = pending[future]
            try:
                course = future.result()
            except Exception as error:  # one dead course page shouldn't end the run
                progress.tick(code, found=False, error=f"{code}: {error}")
                continue
            keep = bool(course) and (not semester or semester.title() in course["semesters"])
            progress.tick(code, found=keep)
            if keep:
                yield course
    finally:
        progress.close()
        pool.shutdown(wait=False, cancel_futures=True)


def save(courses, path):
    courses = sorted(courses, key=lambda c: c["code"])  # results arrive as they finish
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    json.dump(courses, open(path, "w"), indent=2, ensure_ascii=False)

