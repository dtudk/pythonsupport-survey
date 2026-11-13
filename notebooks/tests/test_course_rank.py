"""Self-check for the ranking rules; uses fixed data, no network."""
import io

from pis_lib.courses import rank

COURSES = [
    {"code": "01001", "name": "Mathematics 1a (Polytechnical foundation)", "Content": "Python exercises",
     "enrolled": 1080},
    {"code": "02450", "name": "Introduction to Machine Learning", "Content": "Matlab, R or Python",
     "enrolled": 120},
    {"code": "10060", "name": "Physics (Polytechnical Foundation)", "Content": "mechanics"},
    {"code": "99999", "name": "Basket weaving", "Content": "a pythonesque approach to reeds"},
]
RULES = [
    {"name": "polytechnical foundation", "points": 1, "field": "name", "pattern": "polytechnical foundation"},
    {"name": "mentions python", "points": 3, "field": None, "pattern": r"\bpython\b"},
]
TIERS = [
    {"name": "100+ students", "points": 1, "field": "enrolled", "min": 100, "max": 199},
    {"name": "200+ students", "points": 2, "field": "enrolled", "min": 200},
]

if __name__ == "__main__":
    ranked = rank.rank(COURSES, RULES)
    assert [c["code"] for c in ranked] == ["01001", "02450", "10060", "99999"], ranked
    assert [c["score"] for c in ranked] == [4, 3, 1, 0], [c["score"] for c in ranked]
    assert ranked[0]["reasons"] == ["polytechnical foundation (+1)", "mentions python (+3)"]
    # "pythonesque" is not a mention of Python
    assert ranked[-1]["score"] == 0, ranked[-1]

    # numeric tiers are exclusive, and a course with no published number scores nothing
    tiered = {c["code"]: c["score"] for c in rank.rank(COURSES, TIERS)}
    assert tiered == {"01001": 2, "02450": 1, "10060": 0, "99999": 0}, tiered
    assert rank.rule_hit({"enrolled": 200}, TIERS[1]) and not rank.rule_hit({"enrolled": 199}, TIERS[1])
    assert rank.rule_hit({"enrolled": 199}, TIERS[0]) and not rank.rule_hit({"enrolled": 200}, TIERS[0])
    assert not rank.rule_hit({}, TIERS[0])  # field missing entirely

    out = io.StringIO()
    rank.print_bins(rank.rank(COURSES, TIERS), out, head=1)  # 2 courses score 0
    lines = out.getvalue().splitlines()
    assert lines[1] == "2 points - 1 courses", lines
    assert lines[2].startswith("  01001  Mathematics 1a"), lines[2]
    assert "0 points - 2 courses" in lines, lines
    assert "  ... 1 more" in lines, lines  # only `head` courses per bin are listed

    assert rank.field_value(COURSES[0], "CONTENT") == "Python exercises"  # field lookup ignores case
    assert rank.field_value(COURSES[0], "nosuchfield") == ""
    assert "Basket weaving" in rank.field_value(COURSES[3], None)
    print("ok")
