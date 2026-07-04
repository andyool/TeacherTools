import { useEffect, useRef, useState } from 'react';

export function normalizeStoredStateValue<T>(
  raw: unknown,
  initialValue: T,
  normalize?: (raw: unknown, initialValue: T) => T
) {
  try {
    return normalize ? normalize(raw, initialValue) : (raw as T);
  } catch {
    return initialValue;
  }
}

export function serializeStoredStateValue(value: unknown) {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

export function parseStoredStateValue<T>(serialized: string, fallbackValue: T) {
  try {
    return JSON.parse(serialized) as T;
  } catch {
    return fallbackValue;
  }
}

export function readLocalStorageStateValue<T>(
  key: string,
  initialValue: T,
  normalize?: (raw: unknown, initialValue: T) => T
) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return {
        found: false,
        value: initialValue
      };
    }

    return {
      found: true,
      value: normalizeStoredStateValue(parseStoredStateValue(raw, initialValue), initialValue, normalize)
    };
  } catch {
    return {
      found: false,
      value: initialValue
    };
  }
}

export function getInitialPersistentState<T>(
  key: string,
  initialValue: T,
  normalize?: (raw: unknown, initialValue: T) => T
) {
  const desktopState = window.electronAPI?.getPersistentState(key);
  if (desktopState?.found) {
    return {
      shouldMigrateLocalState: false,
      value: normalizeStoredStateValue(desktopState.value, initialValue, normalize)
    };
  }

  const localState = readLocalStorageStateValue(key, initialValue, normalize);
  return {
    shouldMigrateLocalState: Boolean(window.electronAPI && localState.found),
    value: localState.value
  };
}

export function usePersistentState<T>(
  key: string,
  initialValue: T,
  options?: {
    normalize?: (raw: unknown, initialValue: T) => T;
  }
) {
  const normalize = options?.normalize;
  const shouldMigrateLocalStateRef = useRef(false);
  const lastPersistedSerializedRef = useRef<string | null>(null);
  const [state, setState] = useState<T>(() => {
    const initialState = getInitialPersistentState(key, initialValue, normalize);
    shouldMigrateLocalStateRef.current = initialState.shouldMigrateLocalState;
    lastPersistedSerializedRef.current = serializeStoredStateValue(initialState.value);
    return initialState.value;
  });

  useEffect(() => {
    const serialized = serializeStoredStateValue(state);

    if (!window.electronAPI?.setPersistentState) {
      try {
        window.localStorage.setItem(key, serialized);
        lastPersistedSerializedRef.current = serialized;
      } catch {
        // Ignore local fallback persistence failures.
      }
      return;
    }

    if (serialized === lastPersistedSerializedRef.current && !shouldMigrateLocalStateRef.current) {
      return;
    }

    const nextValue = parseStoredStateValue(serialized, state);
    let cancelled = false;

    void window.electronAPI
      .setPersistentState(key, nextValue)
      .then((saved) => {
        if (cancelled || !saved) {
          return;
        }

        lastPersistedSerializedRef.current = serialized;

        if (shouldMigrateLocalStateRef.current) {
          try {
            window.localStorage.removeItem(key);
          } catch {
            // Ignore cleanup failures and keep the desktop-backed value.
          }

          shouldMigrateLocalStateRef.current = false;
        }
      })
      .catch(() => {
        // Ignore IPC save failures and keep the in-memory state intact.
      });

    return () => {
      cancelled = true;
    };
  }, [key, state]);

  useEffect(() => {
    if (window.electronAPI?.onPersistentStateChanged) {
      return window.electronAPI.onPersistentStateChanged((change) => {
        if (change.key !== key) {
          return;
        }

        const nextState = normalizeStoredStateValue(change.value, initialValue, normalize);
        const nextSerialized = serializeStoredStateValue(nextState);
        lastPersistedSerializedRef.current = nextSerialized;
        shouldMigrateLocalStateRef.current = false;

        setState((current) =>
          serializeStoredStateValue(current) === nextSerialized ? current : nextState
        );
      });
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || event.key !== key) {
        return;
      }

      if (event.newValue === null) {
        lastPersistedSerializedRef.current = serializeStoredStateValue(initialValue);
        setState(initialValue);
        return;
      }

      try {
        const nextState = normalizeStoredStateValue(
          parseStoredStateValue(event.newValue, initialValue),
          initialValue,
          normalize
        );
        lastPersistedSerializedRef.current = serializeStoredStateValue(nextState);
        setState(nextState);
      } catch {
        lastPersistedSerializedRef.current = serializeStoredStateValue(initialValue);
        setState(initialValue);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [initialValue, key, normalize]);

  return [state, setState] as const;
}

export function useNow(liveUntil: number | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());

    if (liveUntil === null || Date.now() >= liveUntil) {
      return;
    }

    const interval = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);

      if (nextNow >= liveUntil) {
        window.clearInterval(interval);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [liveUntil]);

  return now;
}

export function useClockNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  return now;
}
