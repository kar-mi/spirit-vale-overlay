import type { ComponentChildren } from "preact";
import type { Translator } from "@svoverlay/i18n/translate";
import { useEffect, useState } from "preact/hooks";
import { filterSettingsSections, normalizeSettingsSearch } from "./settings-search.ts";
import type { SectionId, SettingsSection } from "./settings-section.ts";

/** `token` changes per request so re-requesting the section already shown still navigates. */
export interface SectionRequest {
  id: SectionId;
  token: number;
}

export interface SettingsLayoutProps {
  sections: SettingsSection[];
  t: Translator;
  requestedSection?: SectionRequest;
}

export function SettingsLayout({ sections, t, requestedSection }: SettingsLayoutProps) {
  const [sectionId, setSectionId] = useState<SectionId>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const requestedId = requestedSection?.id;
  const requestedToken = requestedSection?.token;
  useEffect(() => {
    if (!requestedId) return;
    setSectionId(requestedId);
    setSearchQuery("");
  }, [requestedId, requestedToken]);
  const searching = normalizeSettingsSearch(searchQuery).length > 0;
  const searchResults = filterSettingsSections(searchQuery, sections);
  const matchedItemCount = searchResults.reduce((total, result) => total + result.itemIds.length, 0);
  const selectedSection = sections.find((section) => section.id === sectionId) ?? sections[0];

  const openSection = (id: SectionId): void => {
    setSectionId(id);
    setSearchQuery("");
  };

  const renderItems = (section: SettingsSection, itemIds?: readonly string[]): ComponentChildren => {
    const visibleIds = itemIds ? new Set(itemIds) : undefined;
    return section.items
      .filter((item) => !visibleIds || visibleIds.has(item.id))
      .map((item) => <div class="settings-item" key={item.id}>{item.content}</div>);
  };

  if (!selectedSection) return null;

  return <div class="settings-layout">
    <nav class="settings-sidebar" aria-label={t("settings.nav.label")}>
      {sections.map((section) => <button
        class={!searching && section.id === sectionId ? "settings-nav-item is-active" : "settings-nav-item"}
        type="button"
        aria-current={!searching && section.id === sectionId ? "page" : undefined}
        onClick={() => openSection(section.id)}
        key={section.id}
      >{section.label}</button>)}
    </nav>
    <div class="settings-main">
      <div class="settings-toolbar">
        <label class="settings-search">
          <span aria-hidden="true">⌕</span>
          <input class="input" type="search" value={searchQuery} onInput={(event) => setSearchQuery(event.currentTarget.value)} placeholder={t("settings.search.placeholder")} aria-label={t("settings.search.label")} />
        </label>
      </div>
      {searching ? <section class="settings-results" aria-label={t("settings.search.results.label")}>
        <header class="settings-heading search-heading">
          <h1>{t("settings.search.results.heading")}</h1>
          <p class="search-summary" aria-live="polite">{matchedItemCount === 0 ? t("settings.search.empty", { query: searchQuery.trim() }) : t.plural("settings.search.summary", matchedItemCount)}</p>
        </header>
        {searchResults.map((result) => {
          const section = sections.find((candidate) => candidate.id === result.sectionId)!;
          return <section class="settings-result-group" aria-labelledby={`search-section-${section.id}`} key={section.id}>
            <header class="settings-result-heading"><h2 id={`search-section-${section.id}`}>{section.label}</h2><p>{section.description}</p></header>
            <div class="settings-panel">{renderItems(section, result.itemIds)}</div>
          </section>;
        })}
      </section> : <section class="settings-panel" aria-labelledby={`settings-section-${selectedSection.id}`}>
        <header class="settings-heading"><h1 id={`settings-section-${selectedSection.id}`}>{selectedSection.label}</h1><p>{selectedSection.description}</p></header>
        {renderItems(selectedSection)}
      </section>}
    </div>
  </div>;
}
