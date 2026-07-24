import { useRef } from "react";

export function useStableCallback<Arguments extends unknown[], Result>(
  callback: (...args: Arguments) => Result,
): (...args: Arguments) => Result {
  const latestCallbackRef = useRef(callback);
  latestCallbackRef.current = callback;

  const stableCallbackRef = useRef<(...args: Arguments) => Result>(null);
  if (!stableCallbackRef.current) {
    stableCallbackRef.current = (...args) => latestCallbackRef.current(...args);
  }
  return stableCallbackRef.current;
}
