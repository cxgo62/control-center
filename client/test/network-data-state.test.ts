import assert from 'node:assert/strict';
import test from 'node:test';
import type { NetworkData } from '../src/types.js';
import {
  beginNetworkDataRequest,
  completeNetworkDataRequest,
  failNetworkDataRequest,
  initialNetworkDataState,
  networkDataStatusMessage,
} from '../src/components/network-data-state.js';

const oneHourData: NetworkData = { direct: [], proxy: [], latencySeries: [], probedAt: 1 };
const sevenDayData: NetworkData = { direct: [], proxy: [], latencySeries: [], probedAt: 2 };

test('retains 1-hour payload provenance and labels while a 7-day request fails', () => {
  let state = beginNetworkDataRequest(initialNetworkDataState);
  state = completeNetworkDataRequest(state, oneHourData, '1h');
  state = beginNetworkDataRequest(state);

  assert.equal(state.data, oneHourData);
  assert.equal(state.dataRange, '1h');
  assert.equal(networkDataStatusMessage(state, '7d'), '正在加载 7 天数据，显示上次 1 小时数据');

  state = failNetworkDataRequest(state, '网络数据更新失败');
  assert.equal(state.data, oneHourData);
  assert.equal(state.dataRange, '1h');
  assert.equal(networkDataStatusMessage(state, '7d'), '网络数据更新失败，显示上次 1 小时数据');
});

test('switches payload and provenance to 7-day atomically after success', () => {
  let state = completeNetworkDataRequest(initialNetworkDataState, oneHourData, '1h');
  state = beginNetworkDataRequest(state);
  state = completeNetworkDataRequest(state, sevenDayData, '7d');

  assert.equal(state.data, sevenDayData);
  assert.equal(state.dataRange, '7d');
  assert.equal(state.loading, false);
  assert.equal(state.error, null);
  assert.equal(networkDataStatusMessage(state, '7d'), '');
});
