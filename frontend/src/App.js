import "./App.css";
import { useState, useEffect, ViewTransition } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { AuthProvider } from "./context/AuthContext";
import AuthCallback from "./components/AuthCallback";
import Coach from "./pages/Coach";
import Settings from "./pages/Settings";

// Keeps the Toaster theme in sync with the .light class on <html>.
// Triggered whenever Coach.js or Settings.js toggles the class.
function ToasterBridge() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.classList.contains("light") ? "light" : "dark",
  );
  useEffect(() => {
    const mo = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return <Toaster theme={theme} position="bottom-right" toastOptions={{ style: { fontFamily: "JetBrains Mono, monospace", fontSize: "12px" } }} />;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  const dir = location.pathname === "/settings" ? "nav-forward" : "nav-back";

  // This <ViewTransition> is persistent: it stays mounted and only its
  // <Routes> children swap, so React classifies a route change as an *update*
  // of the boundary, not an enter/exit of it. Setting only enter/exit would
  // mean React never consults the class — which is why they had to be
  // replaced by `update`.
  //
  // Direction is derived from the destination rather than via addTransitionType:
  // React Router commits route changes inside its own startTransition (see its
  // source: React.startTransition around the setState), so a type registered in
  // an outer transition never reaches the commit. With two routes it's
  // deterministic — entering /settings is drilling down, landing on / is
  // returning — and that holds for the back arrow, a menu item, and the
  // browser's own back/forward buttons alike.
  //
  // default="none" keeps anything else React might update inside this
  // boundary (a non-route re-render) from picking up a slide it hasn't earned.
  return (
    <ViewTransition update={dir} default="none">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Coach />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ViewTransition>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
        <ToasterBridge />
      </BrowserRouter>
      <Analytics />
    </div>
  );
}

export default App;
