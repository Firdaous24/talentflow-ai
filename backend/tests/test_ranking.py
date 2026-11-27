"""The ranking is a strict lexicographic sort with grouped ties (design §3.3).

Property tests on generated data (seeded, reproducible; no extra dependency):
each run draws hundreds of random coverage sets and checks every property against
an independent reference, including on shuffled inputs.
"""

import itertools
import random
from datetime import UTC, datetime, timedelta

from app.services.ranking import CoverageKey, Ranked, rank

START = datetime(2026, 11, 27, tzinfo=UTC)


def entries(rng: random.Random, size: int) -> list[Ranked[int]]:
    return [
        Ranked(
            key=CoverageKey(rng.randint(0, 4), rng.randint(0, 3), rng.randint(0, 3)),
            arrived_at=START + timedelta(minutes=rng.randint(0, 20)),
            tie_breaker=f"{index:04d}",
            item=index,
        )
        for index in range(size)
    ]


def better_or_equal(a: CoverageKey, b: CoverageKey) -> bool:
    """Reference order written independently: more required, then more preferred, then fewer to interpret."""
    if a.required_documented != b.required_documented:
        return a.required_documented > b.required_documented
    if a.preferred_documented != b.preferred_documented:
        return a.preferred_documented > b.preferred_documented
    return a.needs_review <= b.needs_review


def check_properties(seed: int) -> None:
    rng = random.Random(seed)
    data = entries(rng, rng.randint(0, 40))
    groups = rank(data)
    flat = [entry for group in groups for entry in group.entries]
    assert sorted(entry.item for entry in flat) == sorted(entry.item for entry in data)  # Nobody is dropped or added.
    for first, second in itertools.pairwise(groups):
        assert better_or_equal(first.key, second.key) and first.key != second.key  # Groups strictly descend.
    for group in groups:
        assert all(entry.key == group.key for entry in group.entries)  # One key per group: ties stay together.
        arrivals = [(entry.arrived_at, entry.tie_breaker) for entry in group.entries]
        assert arrivals == sorted(arrivals)  # Inside a group: arrival order, nothing else.
    assert len({group.key for group in groups}) == len(groups)


def test_order_is_strictly_lexicographic_and_ties_are_grouped():
    for seed in range(500):
        check_properties(seed)


def test_input_order_never_changes_the_result():
    def as_items(groups):
        return [(group.key, [entry.item for entry in group.entries]) for group in groups]

    for seed in range(200):
        rng = random.Random(1000 + seed)
        data = entries(rng, 30)
        shuffled = data[:]
        rng.shuffle(shuffled)
        assert as_items(rank(data)) == as_items(rank(shuffled))


def test_needs_review_only_breaks_ties_after_both_documented_counts():
    a = Ranked(CoverageKey(5, 2, 3), START, "a", "A")  # 5/6 requis · 2/3 souhaités · 3 à interpréter
    b = Ranked(CoverageKey(5, 1, 0), START, "b", "B")
    c = Ranked(CoverageKey(4, 3, 0), START, "c", "C")
    d = Ranked(CoverageKey(5, 2, 1), START + timedelta(minutes=1), "d", "D")
    e = Ranked(CoverageKey(5, 2, 1), START, "e", "E")
    assert [[entry.item for entry in group.entries] for group in rank([a, b, c, d, e])] == [["E", "D"], ["A"], ["B"], ["C"]]


def test_empty_ranking():
    assert rank([]) == []
