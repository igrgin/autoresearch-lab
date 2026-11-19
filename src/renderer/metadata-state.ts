import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

const generation = () => window.lab.metadataGeneration();
const subscribe = (listener: () => void) => window.lab.onMetadataInvalidated(listener);

export const useMetadataEpoch = () => useSyncExternalStore(subscribe, generation);

// A setter belongs to the render that created it. An async continuation from
// an older policy cannot put a body back after notification or a reply barrier.
// Keep unrelated refs (notably uncertain save IDs) and navigation intact.
export function useMetadataState<S>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
export function useMetadataState<S>(initial: S): [S, Dispatch<SetStateAction<S>>];
export function useMetadataState<S>(initial?: S) {
  const empty = useRef(initial);
  const epoch = useMetadataEpoch();
  const [entry, setEntry] = useState(() => ({ epoch, value: initial }));
  useEffect(() => {
    setEntry(current => current.epoch === epoch ? current : { epoch, value: empty.current });
  }, [epoch]);
  const set = useCallback((next: SetStateAction<S | undefined>) => {
    if (generation() !== epoch) return;
    setEntry(current => {
      if (generation() !== epoch) return current;
      const previous = current.epoch === epoch ? current.value : empty.current;
      return { epoch, value: typeof next === 'function' ? (next as (value: S | undefined) => S | undefined)(previous) : next };
    });
  }, [epoch]);
  return [entry.epoch === epoch ? entry.value : empty.current, set] as [S | undefined, Dispatch<SetStateAction<S | undefined>>];
}
