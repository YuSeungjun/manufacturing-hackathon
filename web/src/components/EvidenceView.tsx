import { formatStamp } from "@/lib/date";
import type { DetectionBox } from "@/lib/ppe";

/**
 * 근거 이미지 — 기계 층.
 *
 * samples/ 의 실제 CCTV 프레임을 따랐다. 시안색 박스에 붙은 `클래스 신뢰도` 라벨 탭,
 * 모노 대문자 판독값.
 *
 * 촬영 시각과 카메라는 화면에 덧쓰지 않고 모니터 베젤에 적는다.
 * CCTV 프레임에는 이미 자체 타임코드가 박혀 있어서 겹치면 둘 다 못 읽는다.
 *
 * 박스는 절대 빨개지지 않는다. 기계는 클래스를 탐지할 뿐 위반을 정하지 않는다.
 * 빨강은 사람이 위반으로 확정한 뒤에만 오른쪽 판정란에 나타난다.
 */
export function EvidenceView({
  src,
  boxes,
  highlightCode,
  camera,
  stamp,
}: {
  src: string;
  boxes: DetectionBox[];
  /** 지금 검토 중인 항목. 이것만 밝게 두고 나머지는 죽인다. */
  highlightCode?: string;
  camera?: string;
  stamp?: Date;
}) {
  const visible = boxes.filter((box) => box.kind !== "context" || box.label === "Person");

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
          {stamp ? (
            <span className="scan ml-auto">
              {formatStamp(stamp)}
            </span>
          ) : null}
        </figcaption>
      ) : null}

      <div className="relative">
        {/* 근거 이미지는 로컬 파일이므로 최적화 없이 그대로 띄운다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="AI 탐지 근거 이미지" className="block w-full" />

        {visible.map((box, index) => {
          const dim = highlightCode ? box.code !== highlightCode : false;
          return (
            <span
              key={`${box.code}-${index}`}
              className="absolute"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                border: `${dim ? 1 : 2}px solid var(--scan)`,
                opacity: dim ? 0.3 : 1,
              }}
            >
              {dim ? null : (
                <span
                  className="absolute -top-[1.15rem] left-[-2px] whitespace-nowrap px-1 py-[1px]
                             text-[10.5px] font-bold leading-4 tracking-[0.02em]"
                  style={{
                    background: "var(--scan)",
                    color: "#04141a",
                    fontFamily: "var(--font-robomono), ui-monospace, monospace",
                  }}
                >
                  {box.label} {box.confidence.toFixed(2)}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </figure>
  );
}
