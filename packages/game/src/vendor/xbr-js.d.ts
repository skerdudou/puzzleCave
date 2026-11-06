// xbr-js has no types: the function the board uses (src/render/smoothing.ts). Its src/index.js is
// imported directly (the package's main file does not exist), so its version is pinned exactly in
// package.json: a release could move that file.
declare module 'xbr-js/src/index.js' {
  export function xbr4x(
    pixels: Uint32Array,
    width: number,
    height: number,
    options?: { blendColors?: boolean; scaleAlpha?: boolean },
  ): Uint32Array;
}
