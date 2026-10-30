#!/usr/bin/env node
/**
 * `node tools/release/notes.mjs --manifest latest.json --body-file body.md --out latest.json`
 *
 * Put a release's notes into its manifest (ADR 0044). Run by
 * `release-notes.yml` when a release is published or its notes edited,
 * and by hand to put them in before publishing. Only `notes` changes:
 * the signatures are over the artifacts, not over this document.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { notesFrom } from './manifest.mjs';

const options = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--manifest') options.manifest = argv[++i];
  else if (arg === '--body-file') options.bodyFile = argv[++i];
  else if (arg === '--out') options.out = argv[++i];
  else throw new Error(`unexpected argument ${arg}`);
}
for (const required of ['manifest', 'bodyFile', 'out']) {
  if (!options[required])
    throw new Error(`missing --${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
}
const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
const notes = notesFrom(await readFile(options.bodyFile, 'utf8'));
await writeFile(options.out, `${JSON.stringify({ ...manifest, notes }, null, 2)}\n`);
console.log(`${options.out}: ${notes.length} characters of notes for ${manifest.version}`);
