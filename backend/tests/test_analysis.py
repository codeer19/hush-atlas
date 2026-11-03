from __future__ import annotations

import numpy as np
import pytest

from app.analysis import compute_analysis, load_score_matrix, save_score_matrix


def labels(count: int = 521) -> list[str]:
    return [f"Class {index}" for index in range(count)]


def test_detection_rate_and_events_from_real_score_shape() -> None:
    scores = np.zeros((10, 521), dtype=np.float32)
    scores[:, 7] = [0.1, 0.4, 0.5, 0.2, 0.9, 0.8, 0.1, 0.1, 0.1, 0.1]
    computation = compute_analysis(scores, labels(), threshold=0.3, duration_seconds=5.28)
    stat = computation.class_stats[7]
    assert stat.detected_windows == 4
    assert stat.detection_rate == pytest.approx(0.4)
    assert computation.window_count == 10
    events = [event for event in computation.events if event.class_index == 7]
    assert len(events) == 2
    assert events[0].start_seconds == pytest.approx(0.48)
    assert events[0].end_seconds == pytest.approx(1.92)
    assert events[0].model_score == pytest.approx(0.5)
    assert events[1].start_seconds == pytest.approx(1.92)
    assert events[1].end_seconds == pytest.approx(3.36)
    assert events[1].model_score == pytest.approx(0.9)


def test_no_detection_is_zero_not_missing() -> None:
    scores = np.zeros((4, 521), dtype=np.float32)
    scores[:, 0] = 0.1
    computation = compute_analysis(scores, labels(), 0.3, 2.0)
    assert all(stat.detected_windows == 0 for stat in computation.class_stats)
    assert computation.events == []
    assert len(computation.class_stats) == 521


def test_stats_are_stored_for_all_classes_and_threshold_is_respected() -> None:
    scores = np.full((4, 521), 0.25, dtype=np.float32)
    below = compute_analysis(scores, labels(), 0.3, 2.0)
    above = compute_analysis(scores, labels(), 0.2, 2.0)
    assert below.class_stats[0].detection_rate == 0.0
    assert above.class_stats[0].detection_rate == 1.0


def test_event_end_clamped_to_duration() -> None:
    scores = np.zeros((2, 521), dtype=np.float32)
    scores[:, 3] = 0.9
    computation = compute_analysis(scores, labels(), 0.2, 1.1)
    events = [event for event in computation.events if event.class_index == 3]
    assert events[0].end_seconds == pytest.approx(1.1)


def test_invalid_score_matrix_rejected() -> None:
    with pytest.raises(ValueError):
        compute_analysis(np.zeros((3, 10)), labels(), 0.2, 1.0)
    with pytest.raises(ValueError):
        compute_analysis(np.zeros((0, 521)), labels(), 0.2, 1.0)
    with pytest.raises(ValueError):
        compute_analysis(np.full((2, 521), np.nan), labels(), 0.2, 1.0)
    with pytest.raises(ValueError):
        compute_analysis(np.zeros((2, 521)), labels(), 1.5, 1.0)


def test_score_matrix_roundtrip(tmp_path, settings) -> None:
    scores = np.linspace(0, 1, 521 * 6, dtype=np.float32).reshape(6, 521)
    path = save_score_matrix(settings, 42, 9, scores, labels(), 0.48, 0.96)
    loaded, loaded_labels, hop, window = load_score_matrix(path)
    assert np.allclose(scores, loaded)
    assert loaded_labels == labels()
    assert hop == pytest.approx(0.48)
    assert window == pytest.approx(0.96)
