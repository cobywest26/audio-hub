"use client";

import Image from "next/image";

import type { AppLanguage, TranslationKey } from "@/lib/i18n";

import { useEffect } from "react";

// Shared layout contract for authenticated AudioHub pages.
// Parent pages own the actions and state; AppShell only renders the shell.
type AppShellProps = {
  username: string;
  profileLabel?: string;
  onSnapshots: () => void;
  onReset: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  onProfile: () => void;
  onRecommender: () => void;
  onGlobe: () => void;
  children: React.ReactNode;

  searchValue?: string;
  searchResults?: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  }[];
  searchEmpty?: boolean;
  onSearchChange?: (value: string) => void;
  onSearchSelect?: (username: string) => void;

  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  translate: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

// Main reusable app layout.
// Handles the fixed app bar, user search, navigation icons, language toggle, and toolbar buttons.
export function AppShell({
  children,
  username,
  onSnapshots,
  onReset,
  onProfile,
  onRecommender,
  onGlobe,
  onLogout,
  loggingOut,
  searchValue,
  searchResults,
  searchEmpty,
  onSearchChange,
  onSearchSelect,
  language,
  onLanguageChange,
  translate,
  profileLabel,
}: AppShellProps) {

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("audiohub-language");

    if (savedLanguage === "ENG" || savedLanguage === "SPN") {
      onLanguageChange(savedLanguage);
    }
  }, [onLanguageChange]);

  function handleLanguageChange(nextLanguage: AppLanguage) {
    onLanguageChange(nextLanguage);
    window.localStorage.setItem("audiohub-language", nextLanguage);
  }

  return (
    <main className="audiohub-page">
      <div className="audiohub-stage audiohub-stage--full">
        <div className="audiohub-bg" />

        <div className="audiohub-appbar">
          <div className="audiohub-brand">
            <Image
              src="/audiohub-logo.png"
              alt="AudioHub logo"
              width={32}
              height={32}
              className="audiohub-brand-logo"
              priority
            />
            <div className="audiohub-brand-title">AudioHub</div>
          </div>

          {/* User search area. Results are controlled by the
          parent page so API logic stays outside the layout. */}
          <div className="audiohub-search-shell">
              <input
                type="text"
                className="audiohub-search-input"
                placeholder="Search users..."
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
              />

              {(searchResults && searchResults.length > 0) || searchEmpty ? (
                <div className="audiohub-search-dropdown">
                  {searchResults && searchResults.length > 0 ? (
                    searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        className="audiohub-search-result"
                        onClick={() => onSearchSelect?.(result.username)}
                      >
                        <div className="audiohub-search-result-name">
                          {result.display_name || result.username}
                        </div>
                        <div className="audiohub-search-result-handle">
                          @{result.username}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="audiohub-search-empty">Nothing found</div>
                  )}
                </div>
              ) : null}
          </div>

          <div className="audiohub-icon-pack">
            <button
              type="button"
              className="audiohub-icon-btn"
              onClick={onRecommender}
              aria-label="Recommender"
              title="Recommender"
            >
              <Image
                src="/recommender-icon.png"
                alt="Recommender"
                width={22}
                height={22}
                className="audiohub-nav-icon"
              />
            </button>

            <button
              type="button"
              className="audiohub-icon-btn"
              onClick={onGlobe}
              aria-label="Global Insights"
              title="Global Insights"
            >
              <Image
                src="/globe.svg"
                alt="Global Insights"
                width={22}
                height={22}
                className="audiohub-nav-icon"
              />
            </button>

            <button
              type="button"
              className="audiohub-icon-btn"
              onClick={onProfile}
              aria-label="Profile"
              title="Profile"
            >
              <Image
                src="/avatar.svg"
                alt="Profile"
                width={22}
                height={22}
                className="audiohub-nav-icon"
              />
            </button>
          </div>
        </div>
        <div className="audiohub-toolbar">
          <div className="audiohub-toolbar-left">
            {/* Language selector. Current setup is page-controlled, so each page must pass language state correctly. */}
            <div className="audiohub-language-toggle" role="group" aria-label="Language toggle">
              <button
                type="button"
                className={`audiohub-language-option ${language === "ENG" ? "active" : ""}`}
                onClick={() => handleLanguageChange("ENG")}
              >
                ENG
              </button>
              <button
                type="button"
                className={`audiohub-language-option ${language === "SPN" ? "active" : ""}`}
                onClick={() => handleLanguageChange("SPN")}
              >
                SPN
              </button>
            </div>
          </div>

          <div className="audiohub-toolbar-center">
            <div className="audiohub-user-wrap">
              <span className="audiohub-username">
                {/* Uses profileLabel when viewing another user;
                otherwise falls back to the logged-in user's greeting. */}
                {profileLabel ?? translate("hello_user", { username })}
              </span>
            </div>
          </div>

          <div className="audiohub-toolbar-right">
             <button
                type="button"
                className="audiohub-mini-btn"
                onClick={onSnapshots}
             >
                {translate("previous_snapshots")}
             </button>

             <button
                type="button"
                className="audiohub-mini-btn"
                onClick={onReset}
             >
                {translate("reset")}
             </button>

             <button
               type="button"
               className="audiohub-mini-btn"
               onClick={onLogout}
               disabled={loggingOut}
             >
               {loggingOut ? "Logging Out..." : translate("logout")}
             </button>
          </div>
        </div>

        <div className="audiohub-dashboard-shell">
          <div className="audiohub-dashboard">{children}</div>
        </div>
      </div>
    </main>
  );
}