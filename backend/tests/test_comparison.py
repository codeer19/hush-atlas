from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest

from app.comparison import ComparisonError, LoadedAnalysis, compute_comparison


def labels() -> list[str]:
    return [f"Class {index}" for index in range(521)]


def loaded(
    recording_id: int,
    rates: dict[int, float],
    *,
    windows: int = 10,
    recorded_at: str = "2024-01-01T10:00:00Z",
    sample_rate: int = 44_100,
    source: str = "upload",
) -> LoadedAnalysis:
    scores = np.zeros((windows, 521), dtype=np.float32)
    for class_index, rate in rates.items():
        count = int(round(rate * windows))
        scores[:count, class_index] = 0.9
    return LoadedAnalysis(
        recording_id=recording_id,
        run_id=recording_id + 100,
        title=f"Recording {recording_id}",
        recorded_at=recorded_at,
        duration_seconds=windows * 0.48 + 0.5,
        sample_rate=sample_rate,
        channels=1,
        source=source,
        audio_format="WAV",
        threshold_used=0.2,
        scores=scores,
        labels=labels(),
        hop_seconds=0.48,
        window_seconds=0.96,
        window_count=windows,
    )


def result_for(computation, class_index: int):
    return next(item for item in computation.results if item["class_index"] == class_index)


def test_equal_weighting_per_recording_not_per_window() -> None:
    # One 10-window recording at 100% and one 100-window recording at 0%.
    # Equal-per-recording average is 50%, not the window-weighted ~9%.
    baseline = [
        loaded(1, {0: 1.0}, windows=10),
        loaded(2, {0: 0.0}, windows=100),
    ]
    recent = [loaded(3, {0: 0.0})]
    computation = compute_comparison(
        baseline,
        recent,
        threshold=0.2,
        fading_threshold_pp=10,
        place_name="Garden",
    )
    result = result_for(computation, 0)
    assert result["baseline_rate"] == pytest.approx(0.5)
    assert result["recent_rate"] == pytest.approx(0.0)
    assert result["difference_pp"] == pytest.approx(-50.0)


def test_percentage_point_difference_and_fading() -> None:
    baseline = [loaded(1, {1: 0.8}, windows=10), loaded(2, {1: 0.4}, windows=10)]
    recent = [loaded(3, {1: 0.2}, windows=10), loaded(4, {1: 0.1}, windows=10)]
    computation = compute_comparison(baseline, recent, 0.2, 10, "Garden")
    result = result_for(computation, 1)
    assert result["baseline_rate"] == pytest.approx(0.6)
    assert result["recent_rate"] == pytest.approx(0.15)
    assert result["difference_pp"] == pytest.approx(-45.0)
    assert result["classification"] == "detected_less"
    assert result["fading"] is True
    assert result["baseline_detected_windows"] == 12
    assert result["recent_detected_windows"] == 3
    assert computation.summary["fading_count"] == 1


def test_fading_requires_meaningful_baseline_and_threshold() -> None:
    # A 6% -> 0% drop is less often, but below the 10pp fading rule.
    computation = compute_comparison(
        [loaded(1, {2: 0.06}, windows=100), loaded(2, {2: 0.06}, windows=100)],
        [loaded(3, {2: 0.0}), loaded(4, {2: 0.0})],
        0.2,
        10,
        "Garden",
    )
    result = result_for(computation, 2)
    assert result["difference_pp"] == pytest.approx(-6.0)
    assert result["classification"] == "similar"
    assert result["fading"] is False


def test_configured_fading_threshold_can_suppress_obituary() -> None:
    computation = compute_comparison(
        [loaded(1, {3: 0.8}), loaded(2, {3: 0.6})],
        [loaded(3, {3: 0.4}), loaded(4, {3: 0.2})],
        0.2,
        50.0,
        "Garden",
    )
    result = result_for(computation, 3)
    assert result["difference_pp"] == pytest.approx(-40.0)
    assert result["classification"] == "detected_less"
    assert result["fading"] is False


def test_newly_detected_class() -> None:
    computation = compute_comparison(
        [loaded(1, {}), loaded(2, {})],
        [loaded(3, {4: 0.7}), loaded(4, {4: 0.5})],
        0.2,
        10,
        "Garden",
    )
    result = result_for(computation, 4)
    assert result["baseline_rate"] == 0.0
    assert result["recent_rate"] == pytest.approx(0.6)
    assert result["classification"] == "newly_detected"
    assert result["fading"] is False


def test_similar_rate_is_not_called_change() -> None:
    computation = compute_comparison(
        [loaded(1, {5: 0.5}), loaded(2, {5: 0.6})],
        [loaded(3, {5: 0.5}), loaded(4, {5: 0.5})],
        0.2,
        10,
        "Garden",
    )
    result = result_for(computation, 5)
    assert result["classification"] == "similar"
    assert result["notable"] is False
    assert result["difference_pp"] == pytest.approx(-5.0)


def test_zero_detection_classes_are_omitted() -> None:
    computation = compute_comparison(
        [loaded(1, {6: 0.5}), loaded(2, {6: 0.5})],
        [loaded(3, {6: 0.2}), loaded(4, {6: 0.2})],
        0.2,
        10,
        "Garden",
    )
    assert all(item["class_index"] == 6 for item in computation.results)


def test_empty_groups_rejected() -> None:
    with pytest.raises(ComparisonError, match="baseline"):
        compute_comparison([], [loaded(1, {0: 0.5})], 0.2, 10, "Garden")
    with pytest.raises(ComparisonError, match="recent"):
        compute_comparison([loaded(1, {0: 0.5})], [], 0.2, 10, "Garden")


def test_duplicate_recording_across_groups_rejected() -> None:
    item = loaded(1, {0: 0.5})
    with pytest.raises(ComparisonError, match="both"):
        compute_comparison([item], [item], 0.2, 10, "Garden")


def test_one_recording_per_group_is_marked_limited() -> None:
    computation = compute_comparison(
        [loaded(1, {7: 0.8})], [loaded(2, {7: 0.1})], 0.2, 10, "Garden"
    )
    assert computation.reliability == "limited"
    assert any("One group has fewer than two" in warning for warning in computation.warnings)


def test_evidence_peak_window_uses_actual_window_time() -> None:
    item = loaded(1, {8: 0.3}, windows=10)
    # Detection at windows 0, 1, 2; the peak is equal, argmax returns 0.
    computation = compute_comparison([item], [loaded(2, {8: 0.0})], 0.2, 10, "Garden")
    evidence = result_for(computation, 8)["baseline_recording_rates"][0]
    assert evidence["peak_window_start"] == pytest.approx(0.0)
    assert evidence["peak_window_end"] == pytest.approx(0.96)
    assert evidence["detected_windows"] == 3


def test_threshold_is_applied_to_raw_scores() -> None:
    item = loaded(1, {9: 0.2}, windows=10)  # scores 0.9 on two windows
    high = compute_comparison([item], [loaded(2, {9: 0.2})], 0.95, 10, "Garden")
    assert all(result["class_index"] != 9 for result in high.results)


def test_date_order_and_condition_warnings() -> None:
    computation = compute_comparison(
        [loaded(1, {10: 0.8}, recorded_at="2024-06-01T00:00:00Z", sample_rate=44_100)],
        [loaded(2, {10: 0.2}, recorded_at="2023-06-01T00:00:00Z", sample_rate=48_000)],
        0.2,
        10,
        "Garden",
    )
    assert any("Some recordings in the recent group are older" in warning for warning in computation.warnings)
    assert any("different microphones or audio settings" in warning for warning in computation.warnings)


def test_input_hash_is_deterministic_for_same_evidence() -> None:
    baseline = [loaded(1, {11: 0.8}), loaded(2, {11: 0.6})]
    recent = [loaded(3, {11: 0.2}), loaded(4, {11: 0.1})]
    first = compute_comparison(baseline, recent, 0.2, 10, "Garden")
    second = compute_comparison(baseline, recent, 0.2, 10, "Garden")
    assert first.input_hash == second.input_hash
    changed = compute_comparison(baseline, recent, 0.25, 10, "Garden")
    assert changed.input_hash != first.input_hash
