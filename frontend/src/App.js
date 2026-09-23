import "./App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "./context/AuthContext";
import AuthCallback from "./components/AuthCallback";
import Coach from "./pages/Coach";

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/" element={<Coach />} />
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
        <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { fontFamily: "JetBrains Mono, monospace", fontSize: "12px" } }} />
      </BrowserRouter>
    </div>
  );
}

export default App;
