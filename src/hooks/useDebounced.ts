import { useEffect, useState } from 'react';

/**
 * Custom hook that debounces a value by the specified delay.
 * Useful for preventing excessive re-renders on rapid value changes.
 *
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 200ms)
 * @returns The debounced value
 */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timeoutId);
  }, [value, delay]);

  return debouncedValue;
}
