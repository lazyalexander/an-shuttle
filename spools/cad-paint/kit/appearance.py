"""Baseline. A request with missing finishes needs an agent's attempt-local kit."""


def missing_material(part):
    raise ValueError(f"No proposed material for {part}")
