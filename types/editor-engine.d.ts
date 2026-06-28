// Ambient declarations so the embedded video editor (editor-engine/vendor)
// type-resolves from the Next.js project. The vendor tree is excluded from
// tsc as an entry point, but route files import it, so tsc follows these.
/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "*.glsl" {
  const content: string;
  export default content;
}

declare module "soundtouchjs";

declare module "culori" {
  // Loose typing: the embedded editor is third-party code not held to our
  // strict rules; converter() yields color objects in many spaces.
  export type Rgb = any;
  export function converter(mode: string): (color: unknown) => any;
  export function formatHex(color: unknown): string;
  export function formatHex8(color: unknown): string;
  export function parse(color: string): any;
  const culori: unknown;
  export default culori;
}

// EyeDropper API (used by the editor color picker), not in lib.dom yet.
interface EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}
interface EyeDropperConstructor {
  new (): EyeDropper;
}
declare const EyeDropper: EyeDropperConstructor;
interface Window {
  EyeDropper?: EyeDropperConstructor;
}
