import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /**
     * 스냅샷과 근거 이미지는 Vercel Blob 에 있다. 원격 호스트를 허용하지 않으면
     * next/image 가 렌더 단계에서 막는다.
     *
     * optimizer 는 쓰지 않는다(컴포넌트에서 unoptimized). 수신함 썸네일이 수십 장이고
     * 원본이 CCTV 캡처라서, 변환 비용을 들여 얻을 게 별로 없다.
     */
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
