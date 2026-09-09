import { useEffect, useRef } from "preact/hooks";
import { attachSearchLight } from "../core/searchLight.ts";
import { useSearchInputBindings } from "../search/search.ts";

const placeholders = [
  "search freely...",
  "escape to somewhere",
  "sunshine learning",
  "celebrating 2 years!",
  "always on",
  "true freedom",
];

const pickPlaceholder = () =>
  placeholders[Math.floor(Math.random() * placeholders.length)];

export default function SearchBar() {
  const barRef = useRef(null);
  const placeholderRef = useRef(pickPlaceholder());

  useSearchInputBindings({
    inputId: "searchInput",
    suggestionsId: "suggestions-container",
  });

  useEffect(() => {
    if (barRef.current) {
      attachSearchLight(barRef.current);
    }
  }, []);

  return (
    <div class="search-bar" ref={barRef}>
      <div class="light-border"></div>
      <div class="light-inset-bg"></div>
      <div class="light"></div>
      <i class="fa-solid fa-magnifying-glass search-icon"></i>
      <input
        type="text"
        id="searchInput"
        placeholder={placeholderRef.current}
        autocomplete="off"
      />
      <div id="suggestions-container" class="suggestions-box"></div>
    </div>
  );
}