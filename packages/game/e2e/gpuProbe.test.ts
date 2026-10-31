import { describe, expect, it } from 'vitest';
import { chooseWorkers, isSoftwareRenderer } from './gpuProbe';

const SWIFTSHADER =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const NVIDIA =
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)';

describe('isSoftwareRenderer', () => {
  it('recognises the CPU renderers and the absence of WebGL', () => {
    expect(isSoftwareRenderer(SWIFTSHADER)).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Google SwiftShader')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toBe(
      true,
    );
    expect(isSoftwareRenderer(null)).toBe(true);
  });

  it('a real GPU is not software', () => {
    expect(isSoftwareRenderer(NVIDIA)).toBe(false);
    expect(
      isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'),
    ).toBe(false);
  });
});

describe('chooseWorkers', () => {
  it("leaves Playwright's default with a GPU", () => {
    expect(chooseWorkers(NVIDIA, 16)).toBeUndefined();
  });

  it('gives each software page its cores, at least one worker', () => {
    expect(chooseWorkers(SWIFTSHADER, 16, 5)).toBe(3);
    expect(chooseWorkers(SWIFTSHADER, 16, 4)).toBe(4);
    expect(chooseWorkers(null, 4, 5)).toBe(1);
    expect(chooseWorkers(SWIFTSHADER, 2, 5)).toBe(1);
  });
});
