"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveDangerZoneAction, type EquipmentState } from "@/app/actions/equipment";
import { polygonPoints, ZONE_KIND_LABEL, type ZonePoint } from "@/lib/zone";

type Zone = {
  id: string;
  name: string;
  polygon: ZonePoint[];
  dwellThresholdSec: number;
  kind: string;
  severity: string;
  requiresHarness: boolean;
};

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-act" disabled={pending || disabled}>
      {pending ? "저장 중…" : "위험구역 저장"}
    </button>
  );
}

/**
 * 카메라 정지 프레임 위에 위험구역을 그린다.
 *
 * 좌표는 0~1 정규화라 이미지 실제 크기와 무관하다 — EvidenceView 와 AI 서비스가
 * 같은 규약을 쓰기 때문에 여기서 그린 그대로 판정에 들어간다.
 */
export function ZoneEditor({
  equipmentId,
  cameraId,
  poster,
  zones,
  editing,
}: {
  equipmentId: string;
  cameraId: string | null;
  poster: string;
  zones: Zone[];
  editing: Zone | null;
}) {
  const [points, setPoints] = useState<ZonePoint[]>(editing?.polygon ?? []);
  const [selected, setSelected] = useState<number | null>(null);
  const [state, action] = useActionState<EquipmentState, FormData>(saveDangerZoneAction, null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const toNormalized = useCallback((clientX: number, clientY: number): ZonePoint => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return [round(clamp01((clientX - rect.left) / rect.width)), round(clamp01((clientY - rect.top) / rect.height))];
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current !== null) return;
    const point = toNormalized(event.clientX, event.clientY);
    setPoints((prev) => [...prev, point]);
    setSelected(points.length);
  }

  function handleVertexDown(index: number, event: React.PointerEvent) {
    event.stopPropagation();
    dragging.current = index;
    setSelected(index);
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  function handleVertexMove(event: React.PointerEvent) {
    if (dragging.current === null) return;
    const point = toNormalized(event.clientX, event.clientY);
    setPoints((prev) => prev.map((p, i) => (i === dragging.current ? point : p)));
  }

  function handleVertexUp(event: React.PointerEvent) {
    if (dragging.current === null) return;
    (event.target as Element).releasePointerCapture(event.pointerId);
    // 포인터를 놓은 직후 컨테이너의 click 이 새 점을 찍지 않도록 한 틱 미룬다
    const index = dragging.current;
    setTimeout(() => {
      if (dragging.current === index) dragging.current = null;
    }, 0);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setPoints((prev) => prev.slice(0, -1));
      setSelected(null);
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected !== null) {
      event.preventDefault();
      setPoints((prev) => prev.filter((_, i) => i !== selected));
      setSelected(null);
    }
  }

  const enough = points.length >= 3;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <div
          ref={surfaceRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handleVertexMove}
          onPointerUp={handleVertexUp}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="application"
          aria-label="위험구역 그리기. 화면을 눌러 꼭짓점을 추가하고, 꼭짓점을 끌어 옮깁니다."
          className="plate relative touch-none select-none overflow-hidden"
          style={{ cursor: "crosshair" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poster} alt="카메라 정지 프레임" className="block w-full" draggable={false} />

          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          >
            {/* 이미 그려 둔 다른 구역 — 겹치지 않게 흐리게 깐다 */}
            {zones
              .filter((z) => z.id !== editing?.id && z.polygon.length >= 3)
              .map((zone) => (
                <polygon
                  key={zone.id}
                  points={polygonPoints(zone.polygon)}
                  vectorEffect="non-scaling-stroke"
                  style={{
                    fill: "color-mix(in srgb, var(--scan) 6%, transparent)",
                    stroke: "var(--plate-rule)",
                    strokeWidth: 1,
                    strokeDasharray: "0.01 0.008",
                  }}
                />
              ))}

            {points.length >= 2 ? (
              <polygon
                points={polygonPoints(points)}
                vectorEffect="non-scaling-stroke"
                style={{
                  fill: enough ? "color-mix(in srgb, var(--scan) 16%, transparent)" : "transparent",
                  stroke: "var(--scan)",
                  strokeWidth: 2,
                }}
              />
            ) : null}
          </svg>

          {points.map(([x, y], index) => (
            <span
              key={index}
              onPointerDown={(e) => handleVertexDown(index, e)}
              className="absolute block h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab"
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                background: index === selected ? "var(--paper)" : "var(--scan)",
                border: `2px solid var(--scan)`,
              }}
            />
          ))}
        </div>

        <p className="text-[12.5px] leading-5 text-ink-3">
          화면을 눌러 꼭짓점을 추가하고, 점을 끌어 옮깁니다. 점을 고른 뒤{" "}
          <kbd className="num">Delete</kbd> 로 지우고, <kbd className="num">Esc</kbd> 로 마지막 점을
          되돌립니다. 최소 3점이 필요합니다.
        </p>
      </div>

      <form action={action} className="paper flex flex-col gap-3 p-4">
        <input type="hidden" name="equipmentId" value={equipmentId} />
        <input type="hidden" name="zoneId" value={editing?.id ?? ""} />
        <input type="hidden" name="cameraId" value={cameraId ?? ""} />
        <input type="hidden" name="polygon" value={JSON.stringify(points)} />

        <label className="flex flex-col gap-1.5">
          <span className="label">구역 이름</span>
          <input
            name="name"
            className="input"
            defaultValue={editing?.name ?? ""}
            placeholder="테일 풀리 하부"
            required
            maxLength={40}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label">구역 종류</span>
            <select name="kind" className="input" defaultValue={editing?.kind ?? "PINCH"}>
              {Object.entries(ZONE_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">잔류 기준 (초)</span>
            <input
              name="dwellThresholdSec"
              type="number"
              step="0.5"
              min="0.5"
              max="120"
              className="input num"
              defaultValue={editing?.dwellThresholdSec ?? 5}
            />
            <span className="text-[12px] text-ink-3">
              이 시간을 넘겨 머무르면 잔류로 봅니다. 지나가는 사람과 구분하는 값입니다.
            </span>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="label">심각도</span>
          <select name="severity" className="input" defaultValue={editing?.severity ?? "HIGH"}>
            <option value="HIGH">높음</option>
            <option value="MEDIUM">보통</option>
            <option value="LOW">낮음</option>
          </select>
        </label>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            name="requiresHarness"
            defaultChecked={editing?.requiresHarness ?? false}
            className="mt-0.5"
          />
          <span className="flex flex-col gap-1">
            <span className="label">안전대 체결 확인이 필요한 구역</span>
            <span className="text-[12px] text-ink-3">
              컨베이어 상부·점검대처럼 추락 위험이 있는 곳입니다. 진입은 AI 가 보지만 안전대를
              실제로 걸었는지는 CCTV 로 판정할 수 없어, 이 구역 사건에는 사람이 확인하는 칸이
              함께 열립니다.
            </span>
          </span>
        </label>

        <details className="text-[12.5px] text-ink-3">
          <summary className="cursor-pointer">좌표 직접 보기 · 마우스 없이 편집</summary>
          <ol className="mt-2 flex flex-col gap-1">
            {points.length === 0 ? <li>아직 찍은 점이 없습니다.</li> : null}
            {points.map(([x, y], index) => (
              <li key={index} className="num flex items-center gap-2">
                <span className="w-5 text-right">{index + 1}</span>
                <input
                  type="number" step="0.001" min="0" max="1" value={x}
                  aria-label={`${index + 1}번 점 가로 위치`}
                  onChange={(e) =>
                    setPoints((prev) =>
                      prev.map((p, i) => (i === index ? [clamp01(Number(e.target.value)), p[1]] : p)),
                    )
                  }
                  className="input w-24 py-1"
                />
                <input
                  type="number" step="0.001" min="0" max="1" value={y}
                  aria-label={`${index + 1}번 점 세로 위치`}
                  onChange={(e) =>
                    setPoints((prev) =>
                      prev.map((p, i) => (i === index ? [p[0], clamp01(Number(e.target.value))] : p)),
                    )
                  }
                  className="input w-24 py-1"
                />
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={() => setPoints((prev) => prev.filter((_, i) => i !== index))}
                >
                  지우기
                </button>
              </li>
            ))}
          </ol>
        </details>

        {state && "error" in state ? (
          <p className="text-[13px] font-bold" style={{ color: "var(--deny)" }} role="alert">
            {state.error}
          </p>
        ) : null}
        {state && "ok" in state ? (
          <p className="text-[13px] font-bold" style={{ color: "var(--safe)" }} role="status">
            {state.message}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-quiet btn-sm"
            onClick={() => {
              setPoints([]);
              setSelected(null);
            }}
          >
            처음부터 다시
          </button>
          <span className="num text-[12.5px] text-ink-3">{points.length}점</span>
          <SubmitButton disabled={!enough} />
        </div>
      </form>
    </div>
  );
}
