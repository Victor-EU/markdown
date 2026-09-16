// An agent-style Word document, the kind an AI hands a human to review:
// headings, a table, bullets, a numbered list, bold and italic runs, a
// footnote-free body. Deterministic, so it can be committed.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

const cell = (text, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
const doc = new Document({
  creator: 'make-fixtures.mjs',
  styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
  sections: [{
    children: [
      new Paragraph({ text: 'Northgate Advisory Q2 2026 board memo', heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun({ text: 'Prepared for the board of directors, 22 September 2026. ', italics: true }), new TextRun({ text: 'Draft for review.', bold: true })] }),
      new Paragraph({ text: '1. Summary', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: 'Q2 delivered €10.58m of won business against a €10.5m target, level with Q1 once the Helix one-off is removed and 51.9% ahead of Q4 2025. Deal count rose and average ticket fell; the win rate slipped for a third quarter.', alignment: AlignmentType.JUSTIFIED }),
      new Paragraph({ text: '2. The quarter in numbers', heading: HeadingLevel.HEADING_1 }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ tableHeader: true, children: [cell('Measure', true), cell('Q2 2026', true), cell('Note', true)] }),
        new TableRow({ children: [cell('Won business'), cell('€10.58m'), cell('100.7% of target')] }),
        new TableRow({ children: [cell('vs Q1 2026 (reported)'), cell('−7.0%'), cell('−1.4% without the €640k Helix one-off')] }),
        new TableRow({ children: [cell('Deals won'), cell('143'), cell('avg €74k; Q1 was 131 at €87k')] }),
        new TableRow({ children: [cell('Win rate'), cell('45% / 42.5%'), cell('of deals / of value')] }),
      ] }),
      new Paragraph({ text: '' }),
      new Paragraph({ text: '3. What changed', heading: HeadingLevel.HEADING_1 }),
      ...['Mid-market and public sector carried the quarter.', 'Enterprise losses grew faster than wins, concentrated in two accounts.', 'More than half of the Q3 pipeline is older than 90 days.'].map((t) => new Paragraph({ text: t, bullet: { level: 0 } })),
      new Paragraph({ text: '3.1 Segments', heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: 'Mid-market won €4.1m at a 52% win rate; public sector €3.2m at 61%; enterprise €3.3m at 31%. The enterprise figure is the one to watch: three of the five largest losses were to the same competitor on price.' }),
      new Paragraph({ text: '4. Recommendations', heading: HeadingLevel.HEADING_1 }),
      ...['Re-qualify every pipeline item older than 90 days before the Q3 forecast.', 'Move two enterprise sellers to mid-market for the quarter.', 'Hold the Q3 target at €12.5m and report the weighted pipeline beside it.'].map((t, i) => new Paragraph({ children: [new TextRun(`${i + 1}. ${t}`)] })),
      new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'All figures in EUR; GBP contracts converted at 1 EUR = 0.86 GBP. Source: CRM export of 14 September 2026.', size: 18, color: '666666' })] }),
    ],
  }],
});
mkdirSync(join(import.meta.dirname, '..', 'fixtures'), { recursive: true });
const out = join(import.meta.dirname, '..', 'fixtures', 'agent-memo.docx');
writeFileSync(out, await Packer.toBuffer(doc));
console.log('wrote', out);
