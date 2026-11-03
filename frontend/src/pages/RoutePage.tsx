import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Compass,
  Download,
  MapPin,
  Repeat2,
  Route as RouteIcon,
} from "lucide-react";
import { api } from "../api";
import type { Route } from "../types";
import { formatDateTime, pluralize } from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";

export function RoutePage() {
  const params = useParams();
  const routeId = Number(params.routeId);
  const valid = Number.isInteger(routeId) && routeId > 0;
  const route = useResource<Route>(
    valid ? `route-${routeId}` : "route-invalid",
    () => api.route(routeId),
  );
  useDocumentTitle(route.data ? route.data.name : "Route");

  if (!valid) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="This route could not be opened"
          message="The route address is not valid."
        />
      </div>
    );
  }

  if (route.loading && !route.data) {
    return (
      <div className="shell page">
        <LoadingPanel label="Opening the route" />
      </div>
    );
  }

  if (route.error && !route.data) {
    return (
      <div className="shell page">
        <Breadcrumbs
          items={[{ label: "Routes", to: "/routes" }, { label: "Route" }]}
        />
        <ErrorPanel
          title="This route could not be opened"
          message={route.error}
          onRetry={route.refresh}
        />
      </div>
    );
  }

  if (!route.data) {
    return null;
  }

  const data = route.data;

  return (
    <div className="shell page route-page">
      <Breadcrumbs
        items={[
          { label: "Missions", to: "/" },
          { label: "Routes", to: "/routes" },
          { label: data.name },
        ]}
      />

      <header className="route-header">
        <div>
          <p className="eyebrow">
            <RouteIcon size={13} aria-hidden="true" /> Saved route ·{" "}
            {data.place_name}
          </p>
          <h1>{data.name}</h1>
          {data.description && (
            <p className="route-header__lede">{data.description}</p>
          )}
          <div className="route-header__meta">
            <span>
              <MapPin size={13} aria-hidden="true" />
              <Link to={`/places/${data.place_id}`}>{data.place_name}</Link>
            </span>
            <span>
              <Repeat2 size={13} aria-hidden="true" />
              {data.completed_visit_count}{" "}
              {pluralize(data.completed_visit_count, "completed visit")}
            </span>
            <span className="tabular">{data.stops.length} stops</span>
            <span className="tabular">
              {data.recording_duration_seconds}s per stop
            </span>
          </div>
        </div>
        <div className="route-header__actions">
          <Link
            className="button button--primary"
            to={`/walks/new?route=${data.id}`}
          >
            <Compass size={16} aria-hidden="true" />
            Walk this route
          </Link>
          {data.previous_session && (
            <Link
              className="button button--ghost"
              to={`/walks/${data.previous_session.id}`}
            >
              <ArrowRight size={15} aria-hidden="true" />
              Last visit
            </Link>
          )}
        </div>
      </header>

      <div className="route-layout">
        <section className="route-stops" aria-labelledby="route-stops-heading">
          <header className="hush-section__head">
            <div>
              <p className="eyebrow">The route</p>
              <h2 id="route-stops-heading">Stops.</h2>
            </div>
            <span className="section-heading__count">
              {data.stops.length} {pluralize(data.stops.length, "stop")}
            </span>
          </header>
          <ol className="route-stop-list">
            {data.stops.map((stop) => (
              <li key={stop.id}>
                <span className="route-stop-list__number tabular">
                  {String(stop.stop_order + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{stop.name}</h3>
                  {stop.notes && <p>{stop.notes}</p>}
                  {stop.latitude !== null && stop.longitude !== null && (
                    <p className="route-stop-list__coords tabular">
                      <MapPin size={12} aria-hidden="true" />
                      {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {data.notes && (
            <div className="route-notes">
              <p className="eyebrow">Notes</p>
              <p>{data.notes}</p>
            </div>
          )}
        </section>

        <aside className="route-aside">
          <section className="walk-aside__panel">
            <p className="eyebrow">Visits</p>
            <h2>Visits.</h2>
            {data.sessions.length === 0 ? (
              <p className="walk-aside__muted">
                This route has not been walked yet. The first visit becomes the starting point for a later comparison.
              </p>
            ) : (
              <ul className="route-session-list">
                {data.sessions.map((session) => (
                  <li key={session.id}>
                    <Link to={`/walks/${session.id}`}>
                      <span>
                        {session.title}
                        <StatusBadge
                          status={session.status}
                          kind="walk"
                          compact
                        />
                      </span>
                      <small>
                        <CalendarDays size={12} aria-hidden="true" />
                        {formatDateTime(session.started_at)}
                        {session.completed_at
                          ? " · completed"
                          : " · not completed"}
                      </small>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="walk-aside__panel">
            <p className="eyebrow">Good to know</p>
            <h3>A fair comparison.</h3>
            <p className="walk-aside__muted">
              Keep the route, clip length and time of day similar. Results show broad sound types; a difference does not prove a cause.
            </p>
            {data.previous_session && (
              <a
                className="text-link"
                href={api.walkReportUrl(data.previous_session.id)}
              >
                <Download size={13} aria-hidden="true" /> Download last visit
              </a>
            )}
          </section>
        </aside>
      </div>

      <Link className="back-link" to="/routes">
        <ArrowLeft size={15} aria-hidden="true" /> All routes
      </Link>
    </div>
  );
}
