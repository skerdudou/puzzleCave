// ZzFX ships without types: the part the game uses (see sfx.ts)
declare module 'zzfx' {
  export const ZZFX: {
    volume: number;
    audioContext: AudioContext;
    buildSamples(...params: number[]): number[];
    playSamples(channels: number[][]): AudioBufferSourceNode;
  };
}
