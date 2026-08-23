import { formatStamp } from "@/lib/date";
import { polygonPoints, type TrackBox, type ZonePoint } from "@/lib/zone";

/**
 * 근거 이미지 — 기계 층.
 *
 * 시안색 박스에 붙은 `번호 신뢰도` 라벨 탭, 모노 대문자 판독값.
 * 촬영 시각과 카메라는 화면에 덧쓰지 않고 모니터 베젤에 적는다.
 * CCTV 프레임에는 이미 자체 타임코드가 박혀 있어서 겹치면 둘 다 못 읽는다.
 *
 * 박스는 절대 빨개지지 않는다. 기계는 사람이 어디 있는지 탐지할 뿐 위반을 정하지 않는다.
 * 빨강은 사람이 위험으로 확정한 뒤에만 오른쪽 판정란에 나타난다.
 * 위험이 커진 것은 구역 폴리곤의 농도와 모노 판독값으로만 말한다.
 *
 * 라벨은 `#3` — 익명 추적 번호다. 이름도, 얼굴도, 개인 식별도 없다.
 */
export function EvidenceView({
  src,
  boxes,
  polygon,
  zoneName,
  occupancy,
  dwellSec,
  camera,
  stamp,
}: {
  src: string;
  boxes: TrackBox[];
  /** 위험구역. 정규화 좌표라 이미지 실제 크기를 몰라도 겹칠 수 있다. */
  polygon?: ZonePoint[];
  zoneName?: string;
  /** 이 순간 구역 안에 있던 인원. 있으면 폴리곤을 진하게 칠한다. */
  occupancy?: number;
  dwellSec?: number;
  camera?: string;
  stamp?: Date;
}) {
  const occupied = (occupancy ?? 0) > 0;
  const hasZone = polygon != null && polygon.length >= 3;

  return (
    <figure className="plate overflow-hidden">
      {camera || stamp ? (
        <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 py-1.5">
          {camera ? (
            <span className="flex items-baseline gap-1.5">
              <span className="scan">Cam</span>
              <span className="text-[12px]" style={{ color: "var(--plate-ink)" }}>
                {camera}
              </span>
            </span>
          ) : null}
          {stamp ? <span className="scan ml-auto">{formatStamp(stamp)}</span> : null}
        </figcaption>
      ) : null}

      <div className="relative">
        {/* 근거 이미지는 Blob 또는 로컬 파일이므로 최적화 없이 그대로 띄운다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="AI 탐지 근거 이미지" className="block w-full" />

        {hasZone ? (
          <svg
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <polygon
              points={polygonPoints(polygon!)}
              // viewBox 가 0~1 이라 선 두께도 같이 눌린다. non-scaling-stroke 가 없으면 뭉개진다.
              vectorEffect="non-scaling-stroke"
              style={{
                fill: `color-mix(in srgb, var(--scan) ${occupied ? 28 : 10}%, transparent)`,
                stroke: "var(--scan)",
                strokeWidth: occupied ? 2 : 1,
                strokeDasharray: occupied ? undefined : "0.012 0.008",
              }}
            />
          </svg>
        ) : null}

        {hasZone && (zoneName || dwellSec != null) ? (
          <span
            className="absolute left-1 top-1 flex items-baseline gap-2 px-1.5 py-[2px] text-[10.5px] font-bold leading-4"
            style={{
              background: "rgba(4, 20, 26, 0.72)",
              color: "var(--scan)",
              fontFamily: "var(--font-robomono), ui-monospace, monospace",
            }}
          >
            {zoneName ? <span>ZONE {zoneName}</span> : null}
            {dwellSec != null ? <span>DWELL {dwellSec.toFixed(1)}s</span> : null}
            {occupancy != null ? <span>IN {occupancy}</span> : null}
          </span>
        ) : null}

        {boxes.map((box, index) => (
          <span
            key={`${box.trackId ?? "anon"}-${index}`}
            className="absolute"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              border: `${box.zoneIds.length > 0 ? 2 : 1}px solid var(--scan)`,
              opacity: box.zoneIds.length > 0 ? 1 : 0.45,
            }}
          >
            <span
              className="absolute -top-[1.15rem] left-[-2px] whitespace-nowrap px-1 py-[1px]
                         text-[10.5px] font-bold leading-4 tracking-[0.02em]"
              style={{
                background: "var(--scan)",
                color: "#04141a",
                fontFamily: "var(--font-robomono), ui-monospace, monospace",
              }}
            >
              {box.trackId != null ? `#${box.trackId}` : "person"} {box.confidence.toFixed(2)}
              {/* 발끝을 못 믿는 박스는 조용히 넘기지 않고 화면에 표시한다. */}
              {box.truncated ? " ~" : ""}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}
