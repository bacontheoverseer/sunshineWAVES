import { lazy, Suspense } from "preact/compat";
import Sidebar from "./components/Sidebar.tsx";
import NavBar from "./components/NavBar.tsx";
import SearchBar from "./components/SearchBar.tsx";
import Bookmarks from "./components/Bookmarks.tsx";
import Footer from "./components/Footer.tsx";
import TopBar from "./components/TopBar.tsx";

const loadGamesPage = () => import("./components/GamesPage.tsx");
const GamesPage = lazy(loadGamesPage);
const AppsPage = lazy(() => import("./components/AppsPage.tsx"));
const GameStudioPage = lazy(() => import("./components/GameStudioPage.tsx"));
const ShopPage = lazy(() => import("./components/ShopPage.tsx"));
const GameSpaceModal = lazy(() => import("./components/GameSpaceModal.tsx"));
const NewTabModal = lazy(() => import("./components/NewTabModal.tsx"));
const SettingsMenu = lazy(() => import("./components/SettingsMenu.tsx"));
const ChatModal = lazy(() => import("./components/ChatModal.tsx"));
const AdminPanel = lazy(() => import("./components/AdminPanel.tsx"));

export default function App() {
  return (
    <>
      <TopBar />
      <Sidebar />
      <div class="content-area">
        <NavBar />
        <div class="main-container">
          <div class="title"><img src="/sunshinelogo.png" /></div>
          <SearchBar />
        </div>
        <Bookmarks />
        <Suspense fallback={null}>
          <GamesPage />
        </Suspense>
        <Suspense fallback={null}>
          <AppsPage />
        </Suspense>
        <Suspense fallback={null}>
          <GameStudioPage />
        </Suspense>
        <Suspense fallback={null}>
          <ShopPage />
        </Suspense>
        <div id="iframe-container">
          <div id="iframe-resize-divider"></div>
        </div>
        <Footer />
      </div>
      <Suspense fallback={null}>
        <NewTabModal />
      </Suspense>
      <Suspense fallback={null}>
        <SettingsMenu />
      </Suspense>
      <Suspense fallback={null}>
        <ChatModal />
      </Suspense>
      <Suspense fallback={null}>
        <GameSpaceModal />
      </Suspense>
      <Suspense fallback={null}>
        <AdminPanel />
      </Suspense>
      <div id="overlay" class="overlay" />
    </>
  );
}
