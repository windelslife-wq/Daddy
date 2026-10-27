import { useCallback, useEffect, useRef, useState } from 'react';

export function useLoad(loader, deps = [], { refreshMs = 0, initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const aliveRef = useRef(true);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (aliveRef.current) {
        setData(result);
        setError(null);
        setUpdatedAt(new Date().toISOString());
      }
      return result;
    } catch (err) {
      if (aliveRef.current) setError(err);
      throw err;
    } finally {
      if (aliveRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    reload().catch(() => {});
    let timer = null;
    if (refreshMs > 0) {
      timer = setInterval(() => reload({ silent: true }).catch(() => {}), refreshMs);
    }
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshMs, reload]);

  return { data, setData, loading, error, reload, updatedAt };
}

export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn, options = {}) => {
    setPending(true);
    setError(null);
    try { return await fn(); }
    catch (err) {
      setError(err);
      if (!options.quiet) throw err;
      return null;
    } finally { setPending(false); }
  }, []);
  return { pending, error, run };
}
