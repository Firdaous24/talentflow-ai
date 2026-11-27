"""Transparent ordering by documentary coverage (design §3.3). Non-negotiable rules:

1. The sort key is lexicographic and nothing else:
   (required documented DESC, preferred documented DESC, to-interpret ASC).
   No weight, score, percentage or hidden tie-breaker.
2. Entries with the same key form one group ("same coverage"); inside a group
   the order is arrival order, labelled as not meaningful.
3. Nothing here acts on the order: no threshold, no "top N", no rejection.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class CoverageKey:
    required_documented: int
    preferred_documented: int
    needs_review: int

    def sort_value(self) -> tuple[int, int, int]:
        return (-self.required_documented, -self.preferred_documented, self.needs_review)


@dataclass(frozen=True)
class Ranked(Generic[T]):
    key: CoverageKey
    arrived_at: datetime
    tie_breaker: str  # A stable identifier, only to make equal arrival times deterministic.
    item: T


@dataclass(frozen=True)
class Group(Generic[T]):
    key: CoverageKey
    entries: list[Ranked[T]]


def rank(entries: Sequence[Ranked[T]]) -> list[Group[T]]:
    ordered = sorted(entries, key=lambda entry: (entry.key.sort_value(), entry.arrived_at, entry.tie_breaker))
    groups: list[Group[T]] = []
    for entry in ordered:
        if groups and groups[-1].key == entry.key:
            groups[-1].entries.append(entry)
        else:
            groups.append(Group(key=entry.key, entries=[entry]))
    return groups
