import { Link } from "react-router-dom";
import {
  ArrowRight,
  Compass,
  MapPin,
  Plus,
  Route as RouteIcon,
  Repeat2,
} from "lucide-react";
import { api } from "../api";
import { formatDate, pluralize } from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { PageHeader } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel } from "../components/States";

export function RoutesPage() {
  useDocumentTitle("Routes");
  const routes = useResource("routes-index", api.routes);

  return (
    <div className="shell page routes-page">
      <PageHeader
        eyebrow="Saved routes"
        title="Walk the same ground again."
        lede={
          <p>
            A route remembers your stops, so you can return and compare
            visits.
          </p>
        }
        actions={
          <Link className="button button--primary" to="/walks/new">
            <Compass size={16} aria-hidden="true" />
            Start a walk
          </Link>
        }
      />

      {routes.loading && <LoadingPanel label="Opening saved routes" />}
      {routes.error && (
        <ErrorPanel
          title="Routes could not be opened"
          message={routes.error}
          onRetry={routes.refresh}
        />
      )}

      {routes.data && routes.data.length === 0 && (
        <div className="route-empty">
          <div className="route-empty__mark" aria-hidden="true">
            <RouteIcon size={30} />
          </div>
          <h2>No routes yet.</h2>
          <p>
            Your first walk will save a route here. You can also repeat a walk from its page.
          </p>
          <Link className="button button--primary button--small" to="/walks/new">
            <Plus size={14} aria-hidden="true" /> Start a walk
          </Link>
        </div>
      )}

      {routes.data && routes.data.length > 0 && (
        <div className="route-grid">
          {routes.data.map((route, index) => (
            <article className="route-card" key={route.id}>
              <header className="route-card__head">
                <span className="route-card__index tabular">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="route-card__visits">
                  <Repeat2 size={13} aria-hidden="true" />
                  {route.completed_visit_count}{" "}
                  {pluralize(route.completed_visit_count, "visit")}
                </span>
              </header>
              <h2>
                <Link to={`/routes/${route.id}`}>{route.name}</Link>
              </h2>
              <p className="route-card__place">
                <MapPin size={13} aria-hidden="true" /> {route.place_name}
              </p>
              {route.description && <p>{route.description}</p>}
              <dl className="route-card__facts">
                <div>
                  <dt>Stops</dt>
                  <dd className="tabular">{route.stop_count}</dd>
                </div>
                <div>
                  <dt>Last visit</dt>
                  <dd>
                    {route.last_completed_at
                      ? formatDate(route.last_completed_at)
                      : "Not walked yet"}
                  </dd>
                </div>
                <div>
                  <dt>Clip length</dt>
                  <dd className="tabular">
                    {route.recording_duration_seconds}s
                  </dd>
                </div>
              </dl>
              <footer className="route-card__actions">
                <Link className="text-link" to={`/routes/${route.id}`}>
                  View route <ArrowRight size={13} aria-hidden="true" />
                </Link>
                <Link
                  className="button button--ghost button--small"
                  to={`/walks/new?route=${route.id}`}
                >
                  Walk this route
                </Link>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
