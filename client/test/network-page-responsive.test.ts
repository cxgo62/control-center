import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/components/NetworkPage.tsx'), 'utf8');
const cardsSource = fs.readFileSync(path.join(here, '../src/components/NetworkQualityCards.tsx'), 'utf8');
const widthHookSource = fs.readFileSync(path.join(here, '../src/components/use-element-width.ts'), 'utf8');

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

test('measurement uses one stable callback ref that observes late-mounted chart nodes', () => {
  assert.match(cardsSource, /import \{ useElementWidth \} from '\.\/use-element-width\.js'/);
  assert.match(source, /import \{ useElementWidth \} from '\.\/use-element-width\.js'/);
  assert.match(widthHookSource, /React\.useCallback/);
  assert.match(widthHookSource, /observerRef\.current\?\.disconnect\(\)/);
  assert.match(widthHookSource, /if \(!node\) return/);
  assert.match(widthHookSource, /observer\.observe\(node\)/);
  assert.doesNotMatch(cardsSource, /function useWidth/);
  assert.doesNotMatch(source, /function useElementWidth/);
});

test('charts support pointer and keyboard exploration with accessible live details', () => {
  assert.doesNotMatch(cardsSource, /onMouseMove=/);
  assert.match(cardsSource, /onPointerMove=/);
  assert.match(cardsSource, /onPointerDown=/);
  assert.match(cardsSource, /onKeyDown=/);
  assert.match(cardsSource, /tabIndex=\{0\}/);
  assert.match(cardsSource, /aria-label=/);
  assert.match(cardsSource, /aria-live="polite"/);
  assert.match(cardsSource, /isolatedLatencyPoints/);
});

test('range controls expose selection and refreshes retain the previous network payload', () => {
  assert.match(cardsSource, /aria-pressed=\{range === option\.key\}/);
  assert.doesNotMatch(source, /setData\(null\)/);
  assert.match(source, /networkDataState/);
  assert.match(source, /dataError/);
  assert.match(cardsSource, /statusMessage/);
});

test('retained regional axes use committed data provenance, not the requested range', () => {
  assert.match(source, /dataRangeInfo/);
  assert.match(source, /ticks=\{dataRangeInfo\.ticks\}/);
  assert.doesNotMatch(source, /ticks=\{rangeInfo\.ticks\}/);
  assert.match(source, /setNetworkDataState\(state => completeNetworkDataRequest/);
});

test('background refresh status is announced while retry stays interactive', () => {
  assert.match(cardsSource, /role=\{error \? 'alert' : 'status'\}/);
  assert.match(cardsSource, /aria-live="polite"/);
  assert.match(cardsSource, /onClick=\{onRetry\}/);
});
