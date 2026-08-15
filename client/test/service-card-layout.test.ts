import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SERVICE_CARD_HEIGHT,
  SERVICE_CARD_HEADER_HEIGHT,
  SERVICE_CARD_METRICS_HEIGHT,
  serviceCardKind,
} from '../src/components/service-card-layout.js';

test('keeps service cards and variable content regions at stable heights', () => {
  assert.equal(SERVICE_CARD_HEIGHT, 280);
  assert.equal(SERVICE_CARD_HEADER_HEIGHT, 54);
  assert.equal(SERVICE_CARD_METRICS_HEIGHT, 50);
});

test('selects only the specialized card for the iStoreOS discriminator', () => {
  assert.equal(serviceCardKind({ kind: 'istoreos' }), 'istoreos');
  assert.equal(serviceCardKind({ kind: undefined }), 'standard');
});
