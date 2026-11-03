import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Route as RouteIcon,
} from "lucide-react";
import { api } from "../api";
import type { Mission, RouteSummary } from "../types";
import { getErrorMessage } from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { PageHeader } from "../components/PageHeader";
import { ErrorPanel, LoadingPanel, Spinner } from "../components/States";
import { useToast } from "../components/Toast";

interface DraftStop {
  name: string;
  notes: string;
  latitude: string;
  longitude: string;
  showCoordinates: boolean;
}

function defaultStops(mission: Mission): DraftStop[] {
  return Array.from({ length: mission.suggested_stops }, (_, index) => ({
    name: mission.default_stop_names[index] ?? `Listening point ${index + 1}`,
    notes: "",
    latitude: "",
    longitude: "",
    showCoordinates: false,
  }));
}

export function NewWalkPage() {
  useDocumentTitle("Start a Soundwalk");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { push } = useToast();
  const missions = useResource("new-walk-missions", api.missions);
  const places = useResource("new-walk-places", api.places);
  const routes = useResource("new-walk-routes", api.routes);

  const requestedMission = params.get("mission") ?? "five-sounds";
  const requestedRoute = Number(params.get("route"));
  const [missionKey, setMissionKey] = useState(requestedMission);
  const [placeId, setPlaceId] = useState("");
  const placeTouched = useRef(false);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceDescription, setNewPlaceDescription] = useState("");
  const [creatingPlace, setCreatingPlace] = useState(false);
  const [useSavedRoute, setUseSavedRoute] = useState(
    Number.isInteger(requestedRoute) && requestedRoute > 0,
  );
  const [routeId, setRouteId] = useState(
    Number.isInteger(requestedRoute) && requestedRoute > 0
      ? String(requestedRoute)
      : "",
  );
  const [routeName, setRouteName] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("30");
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locatedStop, setLocatedStop] = useState<number | null>(null);

  const mission = useMemo(
    () => missions.data?.find((item) => item.key === missionKey) ?? null,
    [missions.data, missionKey],
  );
  const savedRoutes = routes.data ?? [];

  useEffect(() => {
    if (!placeTouched.current && places.data && places.data.length > 0 && !placeId) {
      setPlaceId(String(places.data[0].id));
    }
  }, [places.data, placeId]);

  useEffect(() => {
    if (mission) {
      setStops(defaultStops(mission));
    }
  }, [mission]);

  const updateStop = (index: number, patch: Partial<DraftStop>) => {
    setStops((current) =>
      current.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...patch } : stop,
      ),
    );
  };

  const addStop = () => {
    if (!mission || stops.length >= mission.maximum_stops) {
      return;
    }
    setStops((current) => [
      ...current,
      {
        name: `Listening point ${current.length + 1}`,
        notes: "",
        latitude: "",
        longitude: "",
        showCoordinates: false,
      },
    ]);
  };

  const removeStop = (index: number) => {
    if (!mission || stops.length <= mission.minimum_stops) {
      return;
    }
    setStops((current) => current.filter((_, stopIndex) => stopIndex !== index));
  };

  const locateStop = (index: number) => {
    if (!navigator.geolocation) {
      push("This browser cannot find your location. Type the coordinates instead.", "error");
      return;
    }
    setLocatedStop(index);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateStop(index, {
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
          showCoordinates: true,
        });
        setLocatedStop(null);
        push("Location added to this stop.", "success");
      },
      () => {
        setLocatedStop(null);
        push(
          "No location was shared. You can type coordinates or leave them blank.",
          "error",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mission) {
      setError("Choose a mission.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let selectedPlaceId = placeId ? Number(placeId) : null;
      if (!selectedPlaceId) {
        if (!newPlaceName.trim()) {
          throw new Error("Name the place where this walk happens.");
        }
        const created = await api.createPlace(
          newPlaceName.trim(),
          newPlaceDescription.trim(),
        );
        selectedPlaceId = created.id;
        places.refresh();
      }
      if (!selectedPlaceId) {
        throw new Error("Choose a place.");
      }

      if (useSavedRoute) {
        if (!routeId) {
          throw new Error("Choose a saved route, or build a new one.");
        }
      } else {
        if (stops.length < mission.minimum_stops) {
          throw new Error(
            `${mission.title} needs at least ${mission.minimum_stops} listening points.`,
          );
        }
        if (stops.some((stop) => !stop.name.trim())) {
          throw new Error("Every listening point needs a name.");
        }
      }

      const walk = await api.createWalk({
        mission_key: mission.key,
        place_id: selectedPlaceId,
        route_id: useSavedRoute ? Number(routeId) : undefined,
        title: title.trim() || undefined,
        notes: notes.trim(),
        route_name: routeName.trim() || undefined,
        recording_duration_seconds: Number(duration),
        stops: useSavedRoute
          ? []
          : stops.map((stop) => ({
              name: stop.name.trim(),
              notes: stop.notes.trim(),
              latitude: stop.latitude.trim() ? Number(stop.latitude) : null,
              longitude: stop.longitude.trim() ? Number(stop.longitude) : null,
            })),
      });
      push("Walk ready. Listen first, then record.", "success");
      navigate(`/walks/${walk.id}`);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
      setSubmitting(false);
    }
  };

  if (missions.loading) {
    return (
      <div className="shell page">
        <LoadingPanel label="Finding walks" />
      </div>
    );
  }

  if (missions.error || !missions.data) {
    return (
      <div className="shell page">
        <ErrorPanel
          title="Missions could not be opened"
          message={missions.error ?? "No missions are available."}
          onRetry={missions.refresh}
        />
      </div>
    );
  }

  return (
    <div className="shell page new-walk">
      <Link className="back-link" to="/">
        <ArrowLeft size={15} aria-hidden="true" /> Missions
      </Link>
      <PageHeader
        className="new-walk__header"
        eyebrow="Start a Soundwalk"
        title="Plan your walk."
        lede={
          <p>
            Pick a mission, choose where you are, and name your stops. You can
            pause at any time.
          </p>
        }
      />

      <form className="new-walk__form" onSubmit={(event) => void submit(event)}>
        <section className="walk-setup" aria-labelledby="mission-heading">
          <div className="walk-setup__head">
            <span className="walk-setup__step">01</span>
            <div>
              <h2 id="mission-heading">Mission</h2>
              <p>Choose a walk. You can try another one later.</p>
            </div>
          </div>
          <div className="mission-picker" role="radiogroup" aria-label="Mission">
            {missions.data.map((item) => (
              <button
                type="button"
                role="radio"
                aria-checked={item.key === missionKey}
                className={`mission-choice${
                  item.key === missionKey ? " is-selected" : ""
                }`}
                key={item.key}
                onClick={() => setMissionKey(item.key)}
              >
                <span className="mission-choice__check" aria-hidden="true">
                  {item.key === missionKey && <Check size={13} />}
                </span>
                <strong>{item.title}</strong>
                <small>{item.short_description}</small>
              </button>
            ))}
          </div>
          {mission && (
            <div className="mission-purpose">
              <p>{mission.purpose}</p>
              <ul>
                {mission.what_you_will_do.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="walk-setup" aria-labelledby="place-heading">
          <div className="walk-setup__head">
            <span className="walk-setup__step">02</span>
            <div>
              <h2 id="place-heading">Place</h2>
              <p>Choose a place you have saved, or add a new one.</p>
            </div>
          </div>

          {places.loading && <LoadingPanel label="Opening places" compact />}
          {places.error && (
            <ErrorPanel
              title="Places could not be opened"
              message={places.error}
              onRetry={places.refresh}
            />
          )}
          {places.data && places.data.length > 0 && (
            <div className="field">
              <label htmlFor="walk-place">Place</label>
              <select
                id="walk-place"
                value={placeId}
                onChange={(event) => {
                  placeTouched.current = true;
                  setPlaceId(event.currentTarget.value);
                }}
              >
                <option value="">Create a new place</option>
                {places.data.map((place) => (
                  <option value={place.id} key={place.id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!placeId && (
            <div className="new-place-fields">
              <div className="field">
                <label htmlFor="new-place-name">New place name</label>
                <input
                  id="new-place-name"
                  value={newPlaceName}
                  onChange={(event) => setNewPlaceName(event.currentTarget.value)}
                  placeholder="The yard, the lane, the square"
                  maxLength={120}
                />
              </div>
              <div className="field">
                <label htmlFor="new-place-description">
                  Description <span className="field__optional">optional</span>
                </label>
                <textarea
                  id="new-place-description"
                  value={newPlaceDescription}
                  onChange={(event) =>
                    setNewPlaceDescription(event.currentTarget.value)
                  }
                  rows={2}
                  maxLength={4000}
                  placeholder="A note about access, or what you expect to hear."
                />
              </div>
              {creatingPlace && (
                <p className="field__hint">
                  <Spinner size={13} /> This place will be saved when the walk begins.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="walk-setup" aria-labelledby="route-heading">
          <div className="walk-setup__head">
            <span className="walk-setup__step">03</span>
            <div>
              <h2 id="route-heading">Route</h2>
              <p>
                Name the stops on your walk. Location is optional.
              </p>
            </div>
          </div>

          {savedRoutes.length > 0 && (
            <div className="route-mode" role="radiogroup" aria-label="Route mode">
              <button
                type="button"
                role="radio"
                aria-checked={!useSavedRoute}
                className={`route-mode__choice${
                  !useSavedRoute ? " is-selected" : ""
                }`}
                onClick={() => setUseSavedRoute(false)}
              >
                <Plus size={15} aria-hidden="true" />
                New route
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={useSavedRoute}
                className={`route-mode__choice${
                  useSavedRoute ? " is-selected" : ""
                }`}
                onClick={() => setUseSavedRoute(true)}
              >
                <RouteIcon size={15} aria-hidden="true" />
                Saved route
              </button>
            </div>
          )}

          {useSavedRoute ? (
            <div className="field">
              <label htmlFor="saved-route">Route</label>
              <select
                id="saved-route"
                value={routeId}
                onChange={(event) => setRouteId(event.currentTarget.value)}
              >
                <option value="">Choose a route</option>
                {savedRoutes.map((route: RouteSummary) => (
                  <option value={route.id} key={route.id}>
                    {route.name} — {route.place_name} ({route.stop_count} stops)
                  </option>
                ))}
              </select>
              <p className="field__hint">
                This keeps the same stops for your next visit.
              </p>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="route-name">
                  Route name <span className="field__optional">optional</span>
                </label>
                <input
                  id="route-name"
                  value={routeName}
                  onChange={(event) => setRouteName(event.currentTarget.value)}
                  maxLength={160}
                  placeholder={
                    mission
                      ? `${mission.title} route`
                      : "A name for this sequence of stops"
                  }
                />
              </div>

              <div className="field">
                <label htmlFor="walk-title">
                  Walk title <span className="field__optional">optional</span>
                </label>
                <input
                  id="walk-title"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  maxLength={200}
                  placeholder="Evening loop"
                />
              </div>

              <div className="stop-draft-list">
                {stops.map((stop, index) => (
                  <div className="stop-draft" key={index}>
                    <div className="stop-draft__number tabular">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="stop-draft__fields">
                      <div className="field">
                        <label htmlFor={`stop-name-${index}`}>Stop name</label>
                        <input
                          id={`stop-name-${index}`}
                          value={stop.name}
                          onChange={(event) =>
                            updateStop(index, { name: event.currentTarget.value })
                          }
                          maxLength={120}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`stop-notes-${index}`}>
                          Note <span className="field__optional">optional</span>
                        </label>
                        <input
                          id={`stop-notes-${index}`}
                          value={stop.notes}
                          onChange={(event) =>
                            updateStop(index, { notes: event.currentTarget.value })
                          }
                          maxLength={2000}
                          placeholder="A gate, a tree, a bench"
                        />
                      </div>
                      <div className="stop-draft__location">
                        <button
                          type="button"
                          className="text-link text-link--button"
                          onClick={() => locateStop(index)}
                          disabled={locatedStop === index}
                        >
                          {locatedStop === index ? (
                            <Spinner size={13} />
                          ) : (
                            <Crosshair size={13} aria-hidden="true" />
                          )}
                          {locatedStop === index
                            ? "Finding you?"
                            : "Use my location"}
                        </button>
                        <button
                          type="button"
                          className="text-link text-link--button"
                          onClick={() =>
                            updateStop(index, {
                              showCoordinates: !stop.showCoordinates,
                            })
                          }
                        >
                          <MapPin size={13} aria-hidden="true" />
                          {stop.showCoordinates
                            ? "Hide coordinates"
                            : "Add coordinates"}
                        </button>
                      </div>
                      {stop.showCoordinates && (
                        <div className="coordinate-fields">
                          <div className="field">
                            <label htmlFor={`stop-lat-${index}`}>Latitude</label>
                            <input
                              id={`stop-lat-${index}`}
                              type="number"
                              inputMode="decimal"
                              step="0.000001"
                              min="-90"
                              max="90"
                              value={stop.latitude}
                              onChange={(event) =>
                                updateStop(index, {
                                  latitude: event.currentTarget.value,
                                })
                              }
                              placeholder="51.500000"
                            />
                          </div>
                          <div className="field">
                            <label htmlFor={`stop-lon-${index}`}>Longitude</label>
                            <input
                              id={`stop-lon-${index}`}
                              type="number"
                              inputMode="decimal"
                              step="0.000001"
                              min="-180"
                              max="180"
                              value={stop.longitude}
                              onChange={(event) =>
                                updateStop(index, {
                                  longitude: event.currentTarget.value,
                                })
                              }
                              placeholder="-0.120000"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => removeStop(index)}
                      disabled={
                        !mission || stops.length <= mission.minimum_stops
                      }
                      aria-label={`Remove stop ${index + 1}`}
                    >
                      <Minus size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={addStop}
                disabled={!mission || stops.length >= mission.maximum_stops}
              >
                <Plus size={14} aria-hidden="true" />
                Add a stop
              </button>
            </>
          )}

          <div className="walk-settings">
            <div className="field">
              <label htmlFor="walk-duration">Recording length</label>
              <select
                id="walk-duration"
                value={duration}
                onChange={(event) => setDuration(event.currentTarget.value)}
              >
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="45">45 seconds</option>
                <option value="60">60 seconds</option>
                <option value="90">90 seconds</option>
              </select>
              <p className="field__hint">
                A guide for each stop. You can record up to three minutes.
              </p>
            </div>
            <div className="field">
              <label htmlFor="walk-notes">
                Notes <span className="field__optional">optional</span>
              </label>
              <textarea
                id="walk-notes"
                value={notes}
                onChange={(event) => setNotes(event.currentTarget.value)}
                rows={3}
                maxLength={4000}
                placeholder="Weather, time of day, or what you hope to hear."
              />
            </div>
          </div>
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="new-walk__submit">
          <Link className="button button--ghost" to="/">
            Cancel
          </Link>
          <button
            type="submit"
            className="button button--primary"
            disabled={submitting || !mission}
          >
            {submitting ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <ArrowRight size={16} aria-hidden="true" />
            )}
            {submitting ? "Starting?" : "Start walking"}
          </button>
        </div>
      </form>
    </div>
  );
}
