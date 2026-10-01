import { useEffect, useState } from "react";
import { ConsoleApp } from "./ConsoleApp.js";
import { LandingPage } from "./LandingPage.js";

function routeFromPath(): "landing" | "app" {
  return window.location.pathname === "/" ? "landing" : "app";
}

export function App() {
  const [route, setRoute] = useState(routeFromPath);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openApp = () => {
    if (launching) return;
    setLaunching(true);
    window.setTimeout(() => {
      window.history.pushState({}, "", "/app");
      setRoute("app");
      setLaunching(false);
      window.scrollTo(0, 0);
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 1650);
  };

  const openLanding = () => {
    window.history.pushState({}, "", "/");
    setRoute("landing");
    window.scrollTo(0, 0);
  };

  return route === "landing"
    ? <LandingPage onLaunch={openApp} launching={launching} />
    : <ConsoleApp onExit={openLanding} />;
}
