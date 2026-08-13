import type { NetworkData, NetworkRange } from '../types.js';

export type NetworkDataState = {
  data: NetworkData | null;
  dataRange: NetworkRange | null;
  loading: boolean;
  error: string | null;
};

export const initialNetworkDataState: NetworkDataState = {
  data: null,
  dataRange: null,
  loading: true,
  error: null,
};

const RANGE_LABELS: Record<NetworkRange, string> = {
  '1h': '1 小时',
  '6h': '6 小时',
  '24h': '24 小时',
  '7d': '7 天',
};

export function beginNetworkDataRequest(state: NetworkDataState): NetworkDataState {
  return { ...state, loading: true, error: null };
}

export function completeNetworkDataRequest(
  _state: NetworkDataState,
  data: NetworkData,
  dataRange: NetworkRange,
): NetworkDataState {
  return { data, dataRange, loading: false, error: null };
}

export function failNetworkDataRequest(state: NetworkDataState, error: string): NetworkDataState {
  return { ...state, loading: false, error };
}

export function networkDataStatusMessage(state: NetworkDataState, requestedRange: NetworkRange): string {
  const requestedLabel = RANGE_LABELS[requestedRange];
  if (!state.dataRange) return state.error ?? (state.loading ? `正在加载 ${requestedLabel}数据` : '');
  const retainedLabel = RANGE_LABELS[state.dataRange];
  if (state.error) return `${state.error}，显示上次 ${retainedLabel}数据`;
  if (state.loading) return `正在加载 ${requestedLabel}数据，显示上次 ${retainedLabel}数据`;
  return '';
}
