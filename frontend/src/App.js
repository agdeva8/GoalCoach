import "./App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./context/AuthContext";
import AuthCallback from "./components/AuthCallback";
import Coach from "./pages/Coach";
import Settings from "./pages/Settings";

function DynamicToaster() {
  // Respects the .light class on <html> that theme-toggle sets.
  const isLight = document.documentElement.classList.contains("light");
  return <Toaster theme={isLight ? "light" : "dark"} position="bottom-right" toastOptions={{ style: { fontFamily: "JetBrains Mono, monospace", fontSize: "12px" } }} />;
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
        <DynamicToaster />
      </BrowserRouter>
    </div>
  );
}

export default App;
