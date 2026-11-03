import { Link } from "react-router-dom";
import { ArrowRight, Scale } from "lucide-react";
import { api } from "../api";
import {
  formatDate,
  formatDateTime,
  pluralize,
} from "../utils";
import { useDocumentTitle, useResource } from "../hooks";
import { Breadcrumbs, PageHeader } from "../components/PageHeader";
import { EmptyState, ErrorPanel, LoadingPanel } from "../components/States";

export function ComparisonsPage() {
  useDocumentTitle("Compare");
  const comparisons = useResource("comparisons:all", () => api.comparisons());
  const items = comparisons.data ?? [];
  const totalFading = items.reduce((total, item) => total + item.fading_count, 0);
  const places = new Set(items.map((item) => item.place_id)).size;

  return (
    <div className="shell page">
      <Breadcrumbs
        items={[{ label: "My atlas", to: "/archive" }, { label: "Compare" }]}
      />

      <PageHeader
        eyebrow="Your visits"
        title="Compare two visits."
        lede={
          <p>
            See which sounds appeared more or less often between two sets of recordings. Each comparison is saved as a snapshot.
          </p>
        }
        actions={
          items.length > 0 ? (
            <Link className="button button--ghost button--small" to="/">
              <ArrowRight size={14} aria-hidden="true" />
              Choose a place
            </Link>
          ) : undefined
        }
      />

      {items.length > 0 && (
        <section className="comparisons-summary" aria-label="Comparisons summary">
          <div>
            <span>Comparisons</span>
            <strong className="tabular">{items.length}</strong>
          </div>
          <div>
            <span>Places</span>
            <strong className="tabular">{places}</strong>
          </div>
          <div>
            <span>Heard less</span>
            <strong className="tabular">{totalFading}</strong>
          </div>
          <p>
            Up to 100 recent comparisons are kept.
          </p>
        </section>
      )}

      <section className="section comparisons-list-section" aria-labelledby="list-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">Saved comparisons</p>
            <h2 id="list-title">Times you listened.</h2>
          </div>
        </header>

        {comparisons.loading ? (
          <LoadingPanel label="Opening comparisons" />
        ) : comparisons.error ? (
          <ErrorPanel
            title="Comparisons could not be opened"
            message={comparisons.error}
            onRetry={comparisons.refresh}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Scale size={24} />}
            eyebrow="Nothing to compare yet"
            title="A comparison needs two recordings."
            body={
              <p>
                Choose a place with at least two analyzed recordings, then set an
                earlier group against a recent one. The resulting snapshot will
                appear here.
              </p>
            }
            action={
              <Link className="button button--primary" to="/">
                <ArrowRight size={15} aria-hidden="true" />
                Choose a place
              </Link>
            }
          />
        ) : (
          <ol className="comparison-index">
            {items.map((item, index) => (
              <li key={item.id}>
                <Link
                  className="comparison-index__item"
                  to={`/comparisons/${item.id}`}
                >
                  <span className="comparison-index__number tabular">
                    {String(items.length - index).padStart(2, "0")}
                  </span>
                  <span className="comparison-index__main">
                    <span className="comparison-index__place">{item.place_name}</span>
                    <span className="comparison-index__date">
                      {formatDateTime(item.created_at)}
                    </span>
                  </span>
                  <span className="comparison-index__groups">
                    <span>{item.baseline_count} earlier</span>
                    <span className="comparison-index__arrow" aria-hidden="true">
                      →
                    </span>
                    <span>{item.recent_count} recent</span>
                  </span>
                  <span className="comparison-index__signals">
                    <span className="comparison-index__signal comparison-index__signal--fading">
                      <strong className="tabular">{item.fading_count}</strong>{" "}
                      less often
                    </span>
                    <span>
                      <strong className="tabular">{item.notable_count}</strong>{" "}
                      changed
                    </span>
                  </span>
                  <span className="comparison-index__threshold tabular">
                    match level {item.threshold.toFixed(2)}
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        )}

        {items.length > 0 && (
          <p className="section-note">
            {items.length} {pluralize(items.length, "comparison")} saved. Each uses its own match level. Created {formatDate(items[items.length - 1].created_at)} through{" "}
            {formatDate(items[0].created_at)}.
          </p>
        )}
      </section>
    </div>
  );
}
