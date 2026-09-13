import { TreeFragment } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { parser } from './parser.ts';
import { dumpTree } from './tree.ts';

describe('parser', () => {
  it('parses an ATX heading and a GFM table', () => {
    const doc = '# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const tree = parser.parse(doc);
    const names: string[] = [];
    tree.iterate({
      enter: (node) => {
        names.push(node.name);
      },
    });
    expect(names).toContain('ATXHeading1');
    expect(names).toContain('Table');
    expect(names).toContain('TableCell');
  });

  it('never throws on odd input', () => {
    for (const doc of ['', '\r\n', '```', '| |', '[', '$$', '<div>', '\u{feff}# bom']) {
      expect(() => parser.parse(doc)).not.toThrow();
    }
  });

  /**
   * Found by the incremental property test (seed -2069293604): delete the
   * first character of a document whose first line is indented, and the
   * incremental parse kept the old block for that line -- an indented
   * code block where the fresh parse saw a paragraph, or a math block.
   * The tree fragment that survives such a deletion starts at 0 in the
   * new text but mid-line in the old, and @lezer/markdown reused its
   * first-line nodes anyway (patched in pnpm-workspace.yaml).
   */
  describe('incremental parse after a deletion at the start', () => {
    const cases: [string, string][] = [
      ['a math block behind four spaces', '    $$\n\n$$\n\n'],
      ['a code block that becomes a paragraph', '    word\n\nx\n'],
      ['two code lines that become one paragraph', '    a\n    b\n\nx\n'],
    ];
    for (const [label, doc] of cases) {
      it(`agrees with a fresh parse: ${label}`, () => {
        const next = doc.slice(1);
        const fragments = TreeFragment.applyChanges(TreeFragment.addTree(parser.parse(doc)), [
          { fromA: 0, toA: 1, fromB: 0, toB: 0 },
        ]);
        const incremental = parser.parse(next, fragments);
        expect(dumpTree(incremental, next)).toBe(dumpTree(parser.parse(next), next));
      });
    }
  });
});
