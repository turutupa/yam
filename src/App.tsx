import { useEffect, useState } from "react";
import { MainWindow } from "./components/MainWindow";
import { FloatingWidget } from "./components/FloatingWidget";

function getWindowLabel(): string {
  // Tauri v2: window label is passed via URL search param or we detect by URL
  const params = new URLSearchParams(window.location.search);
  return params.get("window") || "main";
}

export default function App() {
  const [windowLabel] = useState(getWindowLabel);

  useEffect(() => {
    // Prevent context menu in production
    if (!import.meta.env.DEV) {
      document.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }, []);

  if (windowLabel === "floating") {
    return <FloatingWidget />;
  }

  return <MainWindow />;
}
