import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Navbar, Footer } from "@/components/layout/Layout";
import Home from "@/pages/Home";
import Categories from "@/pages/Categories";
import CategoryDetail from "@/pages/CategoryDetail";
import TechDetail from "@/pages/TechDetail";
import Compare from "@/pages/Compare";
import MapPage from "@/pages/MapPage";
import CaseStory from "@/pages/CaseStory";
import NotFound from "@/pages/NotFound";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/categories/:slug" element={<CategoryDetail />} />
            <Route path="/tech/:slug" element={<TechDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/cases/:id" element={<CaseStory />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}
