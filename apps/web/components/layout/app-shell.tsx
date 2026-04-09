"use client";

import Image from "next/image";

type AppShellProps = {
  children: React.ReactNode;
  username: string;
  publicProfile: boolean;
  onTogglePublic: () => void;
  onSnapshots: () => void;
  onReset: () => void;
  onProfile: () => void;
  onGlobe: () => void;
  onLogout: () => void;
  loggingOut?: boolean;
};

export function AppShell({
  children,
  username,
  publicProfile,
  onTogglePublic,
  onSnapshots,
  onReset,
  onProfile,
  onGlobe,
  onLogout,
  loggingOut,
}: AppShellProps) {
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

          <div className="audiohub-search-wrap">
            <input
              type="text"
              className="audiohub-search"
              placeholder="Search Username"
              readOnly
            />
          </div>

          <div className="audiohub-icon-pack">
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
            <div className="audiohub-public-wrap">
              <span>Public</span>
              <button
                type="button"
                className={`audiohub-toggle ${publicProfile ? "on" : ""}`}
                onClick={onTogglePublic}
                aria-pressed={publicProfile}
              >
                <span className="audiohub-toggle-knob" />
              </button>
            </div>
          </div>

          <div className="audiohub-toolbar-center">
            <div className="audiohub-user-wrap">
              <span className="audiohub-avatar" />
              <span className="audiohub-username">{username}</span>
            </div>
          </div>

          <div className="audiohub-toolbar-right">
              <button
                type="button"
                className="audiohub-mini-btn"
                onClick={onSnapshots}
              >
                Previous Snapshots
              </button>

              <button
                type="button"
                className="audiohub-mini-btn"
                onClick={onReset}
              >
                Reset
              </button>

              <button
                type="button"
                className="audiohub-mini-btn"
                onClick={onLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Logging Out..." : "Log Out"}
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