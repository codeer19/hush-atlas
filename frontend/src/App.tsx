import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ScrollToTop } from "./components/ScrollToTop";
import { ToastProvider } from "./components/Toast";
import { OnDeviceAIProvider } from "./ondevice/OnDeviceAI";
import { AboutPage } from "./pages/AboutPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ComparePage } from "./pages/ComparePage";
import { ComparisonPage } from "./pages/ComparisonPage";
import { ComparisonsPage } from "./pages/ComparisonsPage";
import { DemoPage } from "./pages/DemoPage";
import { EvidencePage } from "./pages/EvidencePage";
import { FingerprintPage } from "./pages/FingerprintPage";
import { HomePage } from "./pages/HomePage";
import { NewWalkPage } from "./pages/NewWalkPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PlacePage } from "./pages/PlacePage";
import { RecordingPage } from "./pages/RecordingPage";
import { RoutePage } from "./pages/RoutePage";
import { RoutesPage } from "./pages/RoutesPage";
import { SoundMapPage } from "./pages/SoundMapPage";
import { WalkMapPage } from "./pages/WalkMapPage";
import { WalkPage } from "./pages/WalkPage";

function ObituaryRedirect() {
  const params = useParams();
  return (
    <Navigate
      replace
      to={`/comparisons/${params.comparisonId}/evidence/${params.classIndex}`}
    />
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <OnDeviceAIProvider>
          <ScrollToTop />
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="archive" element={<ArchivePage />} />
              <Route path="walks/new" element={<NewWalkPage />} />
              <Route path="walks/:sessionId" element={<WalkPage />} />
              <Route path="walks/:sessionId/map" element={<WalkMapPage />} />
              <Route path="routes" element={<RoutesPage />} />
              <Route path="routes/:routeId" element={<RoutePage />} />
              <Route
                path="recordings/:recordingId/fingerprint"
                element={<FingerprintPage />}
              />
              <Route path="places/:placeId" element={<PlacePage />} />
              <Route
                path="places/:placeId/recordings/:recordingId"
                element={<RecordingPage />}
              />
              <Route path="places/:placeId/compare" element={<ComparePage />} />
              <Route path="places/:placeId/map" element={<SoundMapPage />} />
              <Route path="comparisons" element={<ComparisonsPage />} />
              <Route
                path="comparisons/:comparisonId"
                element={<ComparisonPage />}
              />
              <Route
                path="comparisons/:comparisonId/evidence/:classIndex"
                element={<EvidencePage />}
              />
              <Route
                path="comparisons/:comparisonId/obituary/:classIndex"
                element={<ObituaryRedirect />}
              />
              <Route path="demo" element={<DemoPage />} />
              <Route path="about" element={<AboutPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </OnDeviceAIProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
