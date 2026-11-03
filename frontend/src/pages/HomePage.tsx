import { Link } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  MapPin,
  Route as RouteIcon,
} from "lucide-react";
import { api } from "../api";
import type { Mission, WalkSummary } from "../types";
import { useDocumentTitle, useResource } from "../hooks";
import { formatCount, formatDateTime, formatDuration } from "../utils";
import { ErrorPanel, LoadingPanel } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";

const steps = [
  {
    title: "Listen",
    body: "Pause somewhere safe and record the sounds around you.",
  },
  {
    title: "Discover",
    body: "See what the sound reader detects.",
  },
  {
    title: "Return",
    body: "Revisit a place and compare your recordings.",
  },
];

const heroSources = [640, 960, 1280, 1600, 1920, 2560];

function heroSrcSet(extension: string) {
  return heroSources
    .map((width) => `/images/hero/forest-${width}.${extension} ${width}w`)
    .join(", ");
}

function MissionRow({ mission, index }: { mission: Mission; index: number }) {
  return (
    <Link
      className="mission-row"
      to={`/walks/new?mission=${encodeURIComponent(mission.key)}`}
    >
      <span className="mission-row__number tabular">
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="mission-row__body">
        <h3>{mission.title}</h3>
        <p>{mission.short_description}</p>
      </span>
      <span className="mission-row__meta">
        <span>
          <Clock3 size={13} aria-hidden="true" /> {mission.estimated_duration_minutes} min
        </span>
        <span>
          <MapPin size={13} aria-hidden="true" /> {mission.minimum_stops}–
          {mission.maximum_stops} stops
        </span>
      </span>
      <span className="mission-row__action">
        Start this walk <ArrowRight size={14} aria-hidden="true" />
      </span>
    </Link>
  );
}

function WalkProgress({ walk }: { walk: WalkSummary }) {
  const percent =
    walk.stop_count > 0
      ? Math.round((walk.recorded_count / walk.stop_count) * 100)
      : 0;
  return (
    <Link className="resume-card" to={`/walks/${walk.id}`}>
      <div className="resume-card__lead">
        <span className="resume-card__status">
          <StatusBadge status={walk.status} kind="walk" />
        </span>
        <h3>{walk.title}</h3>
        <p>
          {walk.mission_title} · {walk.place_name}
          {walk.route_name ? ` · ${walk.route_name}` : ""}
        </p>
      </div>
      <div className="resume-card__progress">
        <div className="resume-card__bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <span className="tabular">
          {walk.recorded_count} of {walk.stop_count} stops recorded
        </span>
        <span className="resume-card__time">
          Started {formatDateTime(walk.started_at)}
        </span>
      </div>
      <span className="resume-card__action">
        Keep walking <ArrowRight size={15} aria-hidden="true" />
      </span>
    </Link>
  );
}

export function HomePage() {
  useDocumentTitle();
  const overview = useResource("home-overview", api.overview);
  const missions = useResource("home-missions", api.missions);
  const walks = useResource("home-walks", () => api.walks());
  const routes = useResource("home-routes", api.routes);

  const activeWalks =
    walks.data?.filter((walk) => walk.status !== "completed") ?? [];
  const recentWalks =
    walks.data?.filter((walk) => walk.status === "completed").slice(0, 3) ?? [];
  const previewRoutes = routes.data?.slice(0, 3) ?? [];
  const completedWalks =
    walks.data?.filter((walk) => walk.status === "completed").length ?? 0;

  return (
    <div className="home atlas-home">
      <section className="atlas-hero" aria-labelledby="hero-title">
        <picture className="atlas-hero__media">
          <source type="image/avif" srcSet={heroSrcSet("avif")} sizes="100vw" />
          <source type="image/webp" srcSet={heroSrcSet("webp")} sizes="100vw" />
          <img
            src="/images/hero/forest-1920.jpg"
            srcSet={heroSrcSet("jpg")}
            sizes="100vw"
            alt=""
            width={2560}
            height={1705}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <div className="atlas-hero__veil" aria-hidden="true" />
        <div className="shell atlas-hero__inner">
          <p className="atlas-hero__brand">HUSH ATLAS</p>
          <h1 id="hero-title">
            Map the world by <em>listening</em>.
          </h1>
          <p className="atlas-hero__lede">
            Explore the sounds around you. Discover what you might miss.
          </p>
          <div className="atlas-hero__actions">
            <Link className="button button--primary" to="/walks/new">
              Start a Soundwalk
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="button button--ghost" to="/archive">
              Explore my atlas
            </Link>
          </div>
        </div>
      </section>

      <section className="atlas-steps" aria-labelledby="steps-title">
        <div className="shell">
          <h2 className="visually-hidden" id="steps-title">
            How it works
          </h2>
          <ol className="atlas-steps__grid">
            {steps.map(({ title, body }, index) => (
              <li className="atlas-step" key={title}>
                <span className="atlas-step__number tabular">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="atlas-section atlas-missions" aria-labelledby="missions-title">
        <div className="shell">
          <header className="atlas-section__head">
            <div>
              <p className="eyebrow">Soundwalk missions</p>
              <h2 id="missions-title">Choose a way to listen.</h2>
            </div>
            <Link className="text-link" to="/about">
              How it works <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </header>

          {missions.loading && (
            <LoadingPanel label="Finding walks" compact />
          )}
          {missions.error && (
            <ErrorPanel
              title="Walks could not be opened"
              message={missions.error}
              onRetry={missions.refresh}
            />
          )}
          {missions.data && (
            <ol className="mission-list">
              {missions.data.map((mission, index) => (
                <li key={mission.key}>
                  <MissionRow mission={mission} index={index} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section
        className="atlas-section atlas-section--paper"
        aria-labelledby="atlas-title"
      >
        <div className="shell">
          <header className="atlas-section__head">
            <div>
              <p className="eyebrow">Your atlas</p>
              <h2 id="atlas-title">What you have found so far.</h2>
            </div>
            <Link className="text-link" to="/archive">
              Open my atlas <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </header>

          {overview.loading && (
            <LoadingPanel label="Opening your atlas" compact />
          )}
          {overview.error && !overview.data && (
            <ErrorPanel
              title="Your atlas could not be opened"
              message={overview.error}
              onRetry={overview.refresh}
            />
          )}
          {overview.data && (
            <div className="atlas-stats" aria-label="Your atlas counts">
              <div>
                <span>Places</span>
                <strong className="tabular">
                  {formatCount(overview.data.place_count)}
                </strong>
              </div>
              <div>
                <span>Recordings</span>
                <strong className="tabular">
                  {formatCount(overview.data.recording_count)}
                </strong>
              </div>
              <div>
                <span>Listening time</span>
                <strong className="tabular">
                  {formatDuration(overview.data.total_duration_seconds)}
                </strong>
              </div>
              <div>
                <span>Walks finished</span>
                <strong className="tabular">{formatCount(completedWalks)}</strong>
              </div>
              <div>
                <span>Routes</span>
                <strong className="tabular">
                  {formatCount(routes.data?.length ?? 0)}
                </strong>
              </div>
            </div>
          )}

          {(activeWalks.length > 0 || walks.loading) && (
            <div className="atlas-resume">
              <h3>Pick up where you left off</h3>
              {walks.loading && (
                <LoadingPanel label="Finding unfinished walks" compact />
              )}
              {walks.error && (
                <ErrorPanel
                  title="Walks could not be opened"
                  message={walks.error}
                  onRetry={walks.refresh}
                />
              )}
              <div className="resume-list">
                {activeWalks.map((walk) => (
                  <WalkProgress walk={walk} key={walk.id} />
                ))}
              </div>
            </div>
          )}

          <div className="atlas-columns">
            <section className="atlas-panel" aria-labelledby="recent-visits">
              <div className="atlas-panel__head">
                <h3 id="recent-visits">Recent visits</h3>
                <Link className="text-link" to="/archive">
                  All walks <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
              {recentWalks.length === 0 ? (
                <p className="atlas-panel__empty">
                  Finished walks will appear here, with their route and sounds.
                </p>
              ) : (
                <ul className="atlas-visit-list">
                  {recentWalks.map((walk) => (
                    <li key={walk.id}>
                      <Link to={`/walks/${walk.id}`}>
                        <span>{walk.title}</span>
                        <small>
                          {walk.place_name} ·{" "}
                          {formatDateTime(walk.completed_at ?? walk.started_at)}
                        </small>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="atlas-panel" aria-labelledby="recent-routes">
              <div className="atlas-panel__head">
                <h3 id="recent-routes">Routes to walk again</h3>
                <Link className="text-link" to="/routes">
                  All routes <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
              {routes.loading && (
                <LoadingPanel label="Opening routes" compact />
              )}
              {routes.data && previewRoutes.length === 0 && (
                <p className="atlas-panel__empty">
                  Your first Soundwalk will save a route here.
                </p>
              )}
              <div className="route-preview-list">
                {previewRoutes.map((route) => (
                  <Link
                    className="route-preview"
                    to={`/routes/${route.id}`}
                    key={route.id}
                  >
                    <span className="route-preview__mark" aria-hidden="true">
                      <RouteIcon size={16} />
                    </span>
                    <span className="route-preview__main">
                      <strong>{route.name}</strong>
                      <small>
                        {route.place_name} · {route.stop_count} stops ·{" "}
                        {route.completed_visit_count}{" "}
                        {route.completed_visit_count === 1 ? "visit" : "visits"}
                      </small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          </div>

          {overview.data?.latest_recording && (
            <p className="atlas-latest">
              Latest sound:{" "}
              <Link
                to={`/places/${overview.data.latest_recording.place_id}/recordings/${overview.data.latest_recording.id}`}
              >
                {overview.data.latest_recording.title}
              </Link>{" "}
              at {overview.data.latest_recording.place_name}.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
