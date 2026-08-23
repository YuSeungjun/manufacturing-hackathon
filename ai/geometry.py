"""정규화 좌표 위의 폴리곤 기하.

의존성을 하나도 늘리지 않는다. shapely 는 GEOS 바이너리 15~25MB 를 끌고 오고,
cv2.pointPolygonTest 는 호출마다 폴리곤을 픽셀 int32 컨투어로 바꿔야 해서
정규화 좌표의 정밀도를 잃는다. 순수 파이썬 광선투사가 가장 싸고 정확하다.

비용: 구역 4 × 사람 6 × 5점 × 150프레임 = 18,000회 ≈ 40ms.
프레임당 100ms 넘는 추론 옆에서 반올림 오차다.
"""

from __future__ import annotations

from .config import (
    BOTTOM_SAMPLES,
    FALLBACK_ANCHOR_Y,
    TRUNCATE_ASPECT,
    TRUNCATE_Y,
)

Point = tuple[float, float]
Polygon = list[Point]
Box = tuple[float, float, float, float]  # x, y, w, h — 전부 0~1 정규화


def point_in_polygon(px: float, py: float, poly: Polygon) -> bool:
    """광선투사. 경계 위의 점은 구현 정의 — 히스테리시스가 흡수한다."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py):
            if px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def is_truncated(box: Box) -> bool:
    """접지점을 믿을 수 없는 박스인가.

    프레임 하단에 잘렸거나(발이 화면 밖) 종횡비가 너무 납작하면(하반신 가림)
    bbox 하단은 발이 아니다.
    """
    _, y, w, h = box
    if y + h > TRUNCATE_Y:
        return True
    return w > 0 and h / w < TRUNCATE_ASPECT


def anchor_point(box: Box, truncated: bool | None = None) -> Point:
    """이 박스를 대표하는 바닥 접촉점."""
    x, y, w, h = box
    if truncated is None:
        truncated = is_truncated(box)
    if truncated:
        return x + w / 2, min(y + h * FALLBACK_ANCHOR_Y, 0.999)
    return x + w / 2, min(y + h, 0.999)


def occupancy_score(box: Box, poly: Polygon, truncated: bool | None = None) -> float:
    """구역 점유 정도 0.0~1.0.

    고정 CCTV 는 바닥면을 사영한 영상이다. "구역 안"은 바닥 접촉점이 폴리곤 안이라는
    뜻이므로 접지점 = bbox 하단 중앙이 물리적으로 옳다. 중심점을 쓰면 카메라에 가까운
    키 큰 작업자는 상체가 밖이어도 오탐이 나고, 경계 밖에서 몸을 기울여 넣으면 미탐이 난다.

    단일 점 대신 하단 변에서 5점을 뽑아 0/1 이 아닌 연속값을 만든다.
    히스테리시스에 그대로 물릴 값이 공짜로 생긴다.
    """
    if len(poly) < 3:
        return 0.0
    x, y, w, h = box
    if truncated is None:
        truncated = is_truncated(box)
    if truncated:
        ax, ay = anchor_point(box, True)
        return 1.0 if point_in_polygon(ax, ay, poly) else 0.0

    yb = min(y + h, 0.999)
    hits = sum(point_in_polygon(x + w * t, yb, poly) for t in BOTTOM_SAMPLES)
    return hits / len(BOTTOM_SAMPLES)


def _segments_cross(a: Point, b: Point, c: Point, d: Point) -> bool:
    def orient(p: Point, q: Point, r: Point) -> float:
        return (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])

    o1, o2, o3, o4 = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def validate_polygon(poly: Polygon) -> list[str]:
    """잡 시작 시 1회 검증. 문제를 예외로 던지지 않고 경고로 돌려준다.

    자기교차 폴리곤은 광선투사에서 점유 판정이 뒤집히는 구간이 생긴다.
    데모 중에 거절하는 것보다 경고를 띄우고 진행하는 편이 낫다.
    """
    warnings: list[str] = []
    if len(poly) < 3:
        return ["위험구역 폴리곤의 꼭짓점이 3개 미만입니다."]
    if any(not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0) for x, y in poly):
        warnings.append("위험구역 좌표가 0~1 범위를 벗어났습니다.")

    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        for j in range(i + 1, n):
            # 인접한 변끼리는 꼭짓점을 공유하므로 건너뛴다
            if j == i or (j + 1) % n == i or j == (i + 1) % n:
                continue
            if _segments_cross(a, b, poly[j], poly[(j + 1) % n]):
                warnings.append("위험구역 폴리곤이 자기교차합니다. 점유 판정이 뒤집힐 수 있습니다.")
                return warnings
    return warnings


def distance(a: Point, b: Point) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
