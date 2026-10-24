import { useEffect, useState } from "react";

export type Route =
  | { view: "workspace" }
  | { view: "history" }
  | { view: "compare"; a: string; b: string }
  | { view: "run"; id: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "history") return { view: "history" };
  if (parts[0] === "compare" && parts[1] && parts[2]) return { view: "compare", a: parts[1], b: parts[2] };
  if (parts[0] === "runs" && parts[1]) return { view: "run", id: parts[1] };
  return { view: "workspace" };
}

export function routeHref(route: Route): string {
  switch (route.view) {
    case "workspace":
      return "#/";
    case "history":
      return "#/history";
    case "compare":
      return `#/compare/${encodeURIComponent(route.a)}/${encodeURIComponent(route.b)}`;
    case "run":
      return `#/runs/${encodeURIComponent(route.id)}`;
  }
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [route, (r) => (window.location.hash = routeHref(r))];
}
