import { useEffect, useState } from "react";
import type { HealthResponse } from "../../shared/types";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch(() => setError("The API server is not reachable. Start it with npm run dev."));
  }, []);

  return (
    <main>
      <h1>TracePilot</h1>
      <p>Select a prompt version, start an evaluation, inspect results, and compare runs.</p>
      <p role="status">
        {error ?? (health ? `Server online. Live mode ${health.liveAvailable ? "available" : "unavailable"}.` : "Connecting…")}
      </p>
    </main>
  );
}
