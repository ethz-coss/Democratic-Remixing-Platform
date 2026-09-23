from __future__ import annotations
from datetime import datetime, timedelta, timezone
import random

from tooling.simulations.engine.models import SimulationReport, TimeEvent


class TimeModel:
    def __init__(self, rng: random.Random, target_duration_days: int,
                 time_min_hours: int, time_max_hours: int,
                 time_long_jump_chance: float, time_long_jump_min_days: int,
                 time_long_jump_max_days: int, start_at: str | None = None):
        self.rng = rng
        self.target_duration_days = target_duration_days
        self.time_min_hours = time_min_hours
        self.time_max_hours = time_max_hours
        self.time_long_jump_chance = time_long_jump_chance
        self.time_long_jump_min_days = time_long_jump_min_days
        self.time_long_jump_max_days = time_long_jump_max_days
        self.now = self._parse_start_at(start_at)

    def _parse_start_at(self, value: str | None) -> datetime:
        fallback = datetime.now(timezone.utc) - timedelta(days=self.target_duration_days)
        raw = str(value or "").strip()
        if not raw:
            return fallback
        normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError(f"Invalid --start-at value: {raw}") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def now_iso(self) -> str:
        return self.now.isoformat()

    def now_pb_iso(self) -> str:
        return self.now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    def advance_time(self, step: int, actor: str, action: str, report: SimulationReport) -> None:
        """Advance the simulated clock."""
        if action == "step_started":
            target_hour = self.rng.randint(8, 18)
            target_minute = self.rng.randint(0, 59)

            if self.rng.random() < self.time_long_jump_chance:
                skip_days = self.rng.randint(self.time_long_jump_min_days, self.time_long_jump_max_days)
                next_point = self.now + timedelta(days=skip_days)
            else:
                skip_hours = self.rng.randint(self.time_min_hours, self.time_max_hours)
                next_point = self.now + timedelta(hours=skip_hours)

            delta = next_point.replace(hour=target_hour, minute=target_minute, second=0) - self.now
            if delta.total_seconds() <= 0:
                delta = timedelta(hours=self.rng.randint(self.time_min_hours, self.time_max_hours))
        else:
            delta = timedelta(seconds=self.rng.randint(1, 30))

        self.now = self.now + delta
        report.time_events.append(
            TimeEvent(
                step=step,
                actor=actor,
                action=action,
                simulated_at=self.now_iso(),
            )
        )

    def elapsed_days(self, start: datetime | None) -> int:
        if start is None:
            return 0
        delta = self.now - start
        return max(0, int(delta.total_seconds() // 86400))
