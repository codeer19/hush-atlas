import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Compass,
  MapPinned,
  Mic,
  Plus,
  Route as RouteIcon,
} from "lucide-react";
import { api, isRemoteApi } from "../api";
import type { Place, WalkSummary } from "../types";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  getErrorMessage,
  pluralize,
} from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { PageHeader } from "../components/PageHeader";
import { PlaceDialog } from "../components/PlaceDialog";
import { ErrorPanel, LoadingPanel } from "../components/States";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";

function PlaceRow({ place }: { place: Place }) {
  return (
    <Link className="place-card place-card--hush" to={`/places/${place.id}`}>
      <header className="place-card__head">
        <span className="place-card__index tabular">
          {String(place.id).padStart(2, "0")}
        </span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </header>
      <h3>{place.name}</h3>
      {place.description && <p>{place.description}</p>}
      <footer className="place-card__meta">
        <span>
          {place.recording_count}{" "}
          {pluralize(place.recording_count, "recording")}
        </span>
        <span>
          {place.analyzed_count} with results
        </span>
        <span>
          {place.last_recorded_at
            ? `Last ${formatDate(place.last_recorded_at)}`
            : "No date yet"}
        </span>
      </footer>
    </Link>
  );
}

function WalkRow({ walk }: { walk: WalkSummary }) {
  return (
    <Link className="archive-walk-row" to={`/walks/${walk.id}`}>
      <div className="archive-walk-row__main">
        <div className="archive-walk-row__title">
          <strong>{walk.title}</strong>
          <StatusBadge status={walk.status} kind="walk" compact />
        </div>
        <p>
          {walk.mission_title} · {walk.place_name}
          {walk.route_name ? ` · ${walk.route_name}` : ""}
        </p>
        <small>
          {walk.recorded_count} / {walk.stop_count} recorded ·{" "}
          {walk.analyzed_count} with results ·{" "}
          {walk.completed_at
            ? `finished ${formatDateTime(walk.completed_at)}`
            : `started ${formatDateTime(walk.started_at)}`}
        </small>
      </div>
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

export function ArchivePage() {
  useDocumentTitle("My atlas");
  const overview = useResource("archive-overview", api.overview);
  const places = useResource("archive-places", api.places);
  const walks = useResource("archive-walks", () => api.walks());
  const [dialogOpen, setDialogOpen] = useState(false);
  const { push } = useToast();

  const activeWalks = walks.data?.filter((walk) => walk.status !== "completed") ?? [];
  const completedWalks = walks.data?.filter((walk) => walk.status === "completed") ?? [];
  const refreshAll = () => {
    overview.refresh();
    places.refresh();
    walks.refresh();
  };

  return (
    <div className="shell page">
      <PageHeader
        eyebrow="My atlas"
        title="Everything you have listened to."
        lede={
          <p>
            Every place, walk, and recording you save lives here.{" "}
            {isRemoteApi()
              ? "Recordings you add are uploaded to the Hush Atlas server for analysis and stored there."
              : "Nothing leaves this device."}
          </p>
        }
        actions={
          <>
            <Link className="button button--primary" to="/walks/new">
              <Compass size={16} aria-hidden="true" />
              Start a Soundwalk
            </Link>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDialogOpen(true)}
            >
              <Plus size={16} aria-hidden="true" />
              Add a place
            </button>
          </>
        }
      />

      {overview.data && (
        <section className="archive-summary" aria-label="Archive totals">
          <div>
            <span>Places</span>
            <strong className="tabular">{overview.data.place_count}</strong>
          </div>
          <div>
            <span>Recordings</span>
            <strong className="tabular">{overview.data.recording_count}</strong>
          </div>
          <div>
            <span>Results ready</span>
            <strong className="tabular">{overview.data.analyzed_count}</strong>
          </div>
          <div>
            <span>Listening time</span>
            <strong className="tabular">
              {formatDuration(overview.data.total_duration_seconds)}
            </strong>
          </div>
          <div>
            <span>Walks</span>
            <strong className="tabular">{walks.data?.length ?? 0}</strong>
          </div>
        </section>
      )}

      {overview.error && !overview.data && (
        <ErrorPanel
          title="The archive could not be counted"
          message={overview.error}
          onRetry={refreshAll}
        />
      )}

      <section className="section hush-section">
        <header className="hush-section__head">
          <div>
            <p className="eyebrow">Walks</p>
            <h2>Your walks.</h2>
          </div>
          <Link className="text-link" to="/routes">
            Saved routes <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </header>
        {walks.loading && <LoadingPanel label="Opening walks" compact />}
        {walks.error && (
          <ErrorPanel
            title="Walks could not be opened"
            message={walks.error}
            onRetry={refreshAll}
          />
        )}
        {walks.data && walks.data.length === 0 && (
          <div className="mini-empty">
            <Compass size={20} aria-hidden="true" />
            <p>No walks yet. Start with any mission.</p>
            <Link className="text-link" to="/walks/new">
              Start a walk <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        )}
        {activeWalks.length > 0 && (
          <>
            <p className="archive-group-label">In progress</p>
            <div className="archive-walk-list">
              {activeWalks.map((walk) => (
                <WalkRow walk={walk} key={walk.id} />
              ))}
            </div>
          </>
        )}
        {completedWalks.length > 0 && (
          <>
            <p className="archive-group-label">Completed</p>
            <div className="archive-walk-list">
              {completedWalks.map((walk) => (
                <WalkRow walk={walk} key={walk.id} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="section hush-section">
        <header className="hush-section__head">
          <div>
            <p className="eyebrow">Places</p>
            <h2>Places you have listened.</h2>
          </div>
          <Link className="text-link" to="/routes">
            <RouteIcon size={14} aria-hidden="true" /> Routes
          </Link>
        </header>
        {places.loading && <LoadingPanel label="Opening places" compact />}
        {places.error && (
          <ErrorPanel
            title="Places could not be opened"
            message={places.error}
            onRetry={refreshAll}
          />
        )}
        {places.data && places.data.length === 0 && (
          <div className="mini-empty">
            <MapPinned size={20} aria-hidden="true" />
            <p>A place is somewhere you return to listen.</p>
            <button
              type="button"
              className="text-link text-link--button"
              onClick={() => setDialogOpen(true)}
            >
              Add a place <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {places.data && places.data.length > 0 && (
          <div className="place-grid place-grid--hush">
            {places.data.map((place) => (
              <PlaceRow place={place} key={place.id} />
            ))}
            <button
              type="button"
              className="place-add-card"
              onClick={() => setDialogOpen(true)}
            >
              <Plus size={22} aria-hidden="true" />
              <span>Add a place</span>
            </button>
          </div>
        )}
      </section>

      {completedWalks.length === 0 && activeWalks.length === 0 && (
        <section className="archive-invitation">
          <Mic size={22} aria-hidden="true" />
          <div>
            <h2>A walk can start at the door.</h2>
            <p>
              You do not need a special place. Pick a short, safe loop and listen at a few points along it.
            </p>
          </div>
          <Link className="button button--primary button--small" to="/walks/new">
            Start a walk
          </Link>
        </section>
      )}

      <PlaceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={async ({ name, description }) => {
          try {
            await api.createPlace(name, description);
            setDialogOpen(false);
            places.refresh();
            overview.refresh();
            push("Place added.", "success");
          } catch (error) {
            throw new Error(getErrorMessage(error));
          }
        }}
      />
    </div>
  );
}
