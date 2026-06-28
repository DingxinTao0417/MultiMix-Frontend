// Stub for next/image — renders a plain <img> tag
import type { ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
};

export default function Image({ fill, priority, quality, unoptimized, ...props }: ImageProps) {
  return <img {...props} />;
}
