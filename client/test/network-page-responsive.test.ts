import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/components/NetworkPage.tsx'), 'utf8');

test('switches the network content grid to one column when its available width is narrow', () => {
  assert.match(source, /contentWidth < 760/);
  assert.match(source, /gridTemplateColumns: narrowContent \? 'minmax\(0,1fr\)'/);
  assert.match(source, /overflowY: narrowContent \? 'auto'/);
});
