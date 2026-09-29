import "./App.css";
import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
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
  return (
    <Routes>
      <Route path="/" element={<Coach />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
    </div>
  );
}

export default App;
