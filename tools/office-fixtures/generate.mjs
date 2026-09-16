#!/usr/bin/env node
/**
 * The Word documents and the deck `apps/desktop/src/lib/paged/` tests
 * against (ADR 0042), in the shape of `tools/pdf-fixtures`.
 *
 * Committed, because a test that generates its own fixture tests the
 * generator; written by this script, because a committed binary nobody
 * can regenerate is a fossil. They are made by the two libraries agents
 * reach for when they write these files — `docx` and `pptxgenjs` — so
 * they are the files the app exists to show:
 *
 * - `memo.docx`: one page with a title, headings, a table, bullets and a
 *   numbered list. The kind of thing an agent hands a human.
 * - `long.docx`: the same paragraph forty times over, so it runs to many
 *   pages and the engine's progressive layout has something to be
 *   progressive about.
 * - `deck.pptx`: five slides — a title, bullets, a table, a shape with
 *   text, and one with speaker notes.
 * - `not-ooxml.docx`: a text file wearing the extension, for the
 *   `corrupt` case.
 *
 * Run with `pnpm office:fixtures`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';

const OUT = join(import.meta.dirname, '../../apps/desktop/src/lib/paged/fixtures');
mkdirSync(OUT, { recursive: true });

const cell = (text, bold = false) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });

/** The dates are fixed so the bytes are the same on every run. */
const memo = new Document({
  creator: 'tools/office-fixtures',
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
  sections: [
    {
      children: [
        new Paragraph({ text: 'Northgate Advisory Q2 board memo', heading: HeadingLevel.TITLE }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Prepared for the board, 22 September 2026. ', italics: true }),
            new TextRun({ text: 'Draft for review.', bold: true }),
          ],
        }),
        new Paragraph({ text: '1. Summary', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          text: 'Q2 delivered €10.58m of won business against a €10.5m target, level with Q1 once the Helix one-off is removed and 51.9% ahead of Q4. Deal count rose and average ticket fell; the win rate slipped for a third quarter.',
          alignment: AlignmentType.JUSTIFIED,
        }),
        new Paragraph({ text: '2. The quarter in numbers', heading: HeadingLevel.HEADING_1 }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: [cell('Measure', true), cell('Q2', true), cell('Note', true)],
            }),
            new TableRow({
              children: [cell('Won business'), cell('€10.58m'), cell('100.7% of target')],
            }),
            new TableRow({ children: [cell('Deals won'), cell('143'), cell('average €74k')] }),
            new TableRow({ children: [cell('Win rate'), cell('45%'), cell('of deals')] }),
          ],
        }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '3. What changed', heading: HeadingLevel.HEADING_1 }),
        ...[
          'Mid-market and public sector carried the quarter.',
          'Enterprise losses grew faster than wins.',
          'More than half of the Q3 pipeline is older than 90 days.',
        ].map((text) => new Paragraph({ text, bullet: { level: 0 } })),
        new Paragraph({ text: '4. Recommendations', heading: HeadingLevel.HEADING_1 }),
        ...[
          'Re-qualify every pipeline item older than 90 days.',
          'Move two enterprise sellers to mid-market for the quarter.',
        ].map((text, i) => new Paragraph({ children: [new TextRun(`${i + 1}. ${text}`)] })),
      ],
    },
  ],
});

const PARAGRAPH =
  'The quick brown fox jumps over the lazy dog, and then does it again, because a fixture that runs to many pages needs many words and these are as good as any. ';

const long = new Document({
  creator: 'tools/office-fixtures',
  styles: { default: { document: { run: { font: 'Calibri', size: 24 } } } },
  sections: [
    {
      children: [
        new Paragraph({ text: 'A long document', heading: HeadingLevel.TITLE }),
        ...Array.from(
          { length: 160 },
          (_, i) => new Paragraph({ text: `Paragraph ${i + 1}. ${PARAGRAPH.repeat(3)}` }),
        ),
      ],
    },
  ],
});

async function deck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'tools/office-fixtures';
  const title = pptx.addSlide();
  title.background = { color: '1F3864' };
  title.addText('Q2 Business Review', {
    x: 0.6,
    y: 1.6,
    w: 8.8,
    h: 1,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
  });
  title.addText('Northgate Advisory · Board of Directors', {
    x: 0.6,
    y: 2.7,
    w: 8.8,
    h: 0.5,
    fontSize: 18,
    color: 'DDE3EA',
  });
  const bullets = pptx.addSlide();
  bullets.addText('Three things to take away', {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.8,
    fontSize: 28,
    bold: true,
  });
  bullets.addText(
    [
      {
        text: 'Q2 made target, and the growth is real.',
        options: { bullet: true, breakLine: true },
      },
      { text: 'Win rate is slipping in enterprise.', options: { bullet: true, breakLine: true } },
      { text: 'Half the pipeline is stale.', options: { bullet: true } },
    ],
    { x: 0.7, y: 1.3, w: 8.6, h: 3, fontSize: 20 },
  );
  const table = pptx.addSlide();
  table.addText('The quarter in numbers', {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.8,
    fontSize: 28,
    bold: true,
  });
  table.addTable(
    [
      [
        { text: 'Measure', options: { bold: true } },
        { text: 'Q2', options: { bold: true } },
      ],
      ['Won business', '€10.58m'],
      ['Deals won', '143'],
      ['Win rate', '45%'],
    ],
    {
      x: 0.7,
      y: 1.3,
      w: 6,
      colW: [3, 3],
      fontSize: 16,
      border: { type: 'solid', pt: 1, color: '999999' },
    },
  );
  const shape = pptx.addSlide();
  shape.addText('Pipeline into Q3', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
  shape.addShape(pptx.ShapeType.roundRect, {
    x: 1,
    y: 1.5,
    w: 4,
    h: 2,
    fill: { color: 'E8EEF5' },
    line: { color: '1F3864', width: 1 },
  });
  shape.addText('€43.3m open · 3.5× the target', {
    x: 1,
    y: 1.5,
    w: 4,
    h: 2,
    fontSize: 18,
    align: 'center',
  });
  const notes = pptx.addSlide();
  notes.addText('Questions', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
  notes.addNotes('Thank the board, then take questions on the enterprise losses first.');
  const data = await pptx.write({ outputType: 'nodebuffer' });
  return data;
}

writeFileSync(join(OUT, 'memo.docx'), await Packer.toBuffer(memo));
writeFileSync(join(OUT, 'long.docx'), await Packer.toBuffer(long));
writeFileSync(join(OUT, 'deck.pptx'), await deck());
writeFileSync(
  join(OUT, 'not-ooxml.docx'),
  'This is not a Word document, whatever its name says.\n',
);
console.log(`wrote memo.docx, long.docx, deck.pptx and not-ooxml.docx to ${OUT}`);
