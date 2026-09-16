import { describe, expect, it } from 'vitest';
import { OFFICE_FONT_FAMILIES, officeFontsReady } from './office-fonts.ts';

describe('the stand-ins for Word’s fonts (ADR 0042)', () => {
  it('registers Calibri and Cambria, and has them loaded before it answers', async () => {
    await officeFontsReady();
    for (const family of OFFICE_FONT_FAMILIES) {
      const faces = [...document.fonts].filter((face) => face.family.replace(/"/g, '') === family);
      // Regular, bold, italic and bold italic.
      expect(faces.length).toBe(4);
      for (const face of faces) expect(face.status).toBe('loaded');
    }
  });

  it('answers once, however many adapters ask', async () => {
    const first = officeFontsReady();
    expect(officeFontsReady()).toBe(first);
    await first;
  });

  it('measures Calibri as Carlito would, so Word’s line breaks hold', async () => {
    await officeFontsReady();
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('no canvas');
    context.font = '100px Calibri';
    const calibri = context.measureText('The quick brown fox jumps over the lazy dog').width;
    context.font = '100px Arial';
    const arial = context.measureText('The quick brown fox jumps over the lazy dog').width;
    // Calibri is narrower than Arial by a tenth; if the platform had
    // substituted Arial for a name it did not know, the two would agree.
    expect(calibri).toBeLessThan(arial * 0.95);
  });
});
