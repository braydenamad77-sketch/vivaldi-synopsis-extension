export function trackLatestLookupRequest(currentRequestId: string, nextRequestId: string | undefined) {
  return nextRequestId || currentRequestId;
}

export function isStaleLookupResponse(latestRequestId: string, responseRequestId: string | undefined) {
  if (!latestRequestId || !responseRequestId) return false;
  return latestRequestId !== responseRequestId;
}
