import { useCallback, useEffect, useState } from "react";

export default function useApi(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, dependencies);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
