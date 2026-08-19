import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { StudioImage } from "./pages/StudioImage";
import { StudioVideo } from "./pages/StudioVideo";
import { StudioMusic } from "./pages/StudioMusic";
import { StudioAudio } from "./pages/StudioAudio";
import { Studio3D } from "./pages/Studio3D";
import { Library } from "./pages/Library";
import { Models } from "./pages/Models";
import { Settings } from "./pages/Settings";
import { ApiDocs } from "./pages/ApiDocs";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/image" replace />} />
        <Route path="/image" element={<StudioImage />} />
        <Route path="/video" element={<StudioVideo />} />
        <Route path="/music" element={<StudioMusic />} />
        <Route path="/audio" element={<StudioAudio />} />
        <Route path="/3d" element={<Studio3D />} />
        <Route path="/library" element={<Library />} />
        <Route path="/models" element={<Models />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/api" element={<ApiDocs />} />
      </Route>
    </Routes>
  );
}
