import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/components/NetworkPage.tsx'), 'utf8');
const cardsSource = fs.readFileSync(path.join(here, '../src/components/NetworkQualityCards.tsx'), 'utf8');

test('switches the network content grid to one column when its available width is narrow', () => {
  assert.match(source, /contentWidth < 760/);
  assert.match(source, /gridTemplateColumns: narrowContent \? 'minmax\(0,1fr\)'/);
  assert.match(source, /overflowY: narrowContent \? 'auto'/);
});

test('stacks the fixed sidebar above network content at narrow viewport widths', () => {
  assert.match(source, /className="network-page-shell"/);
  assert.match(source, /className="network-sidebar"/);
  assert.match(source, /@media \(max-width: 820px\)/);
  assert.match(source, /\.network-page-shell\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(source, /\.network-sidebar\s*\{[^}]*width:\s*auto/s);
  assert.match(source, /\.network-page-shell\s*\{[^}]*overflow-y:\s*auto/s);
});

test('chart tooltips do not intercept pointer movement from their chart', () => {
  assert.match(cardsSource, /pointerEvents:\s*'none'/);
  assert.doesNotMatch(cardsSource, /stopPropagation/);
});

test('VPS polling guards state with a monotonic request sequence', () => {
  assert.match(source, /vpsRequestIdRef/);
  assert.match(source, /shouldCommitLatestRequest/);
});
