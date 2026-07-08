import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { EventDetailPage } from "./pages/EventDetail";
import { EventsPage } from "./pages/Events";
import { SignalsPage } from "./pages/Signals";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/event/:id" element={<EventDetailPage />} />
          <Route path="/signals" element={<SignalsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
