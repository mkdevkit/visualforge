import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Overview } from "./pages/Overview";
import { Models } from "./pages/Models";
import { Workflows } from "./pages/Workflows";
import { Settings } from "./pages/Settings";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<Overview />} />
        <Route path="/models" element={<Models />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
