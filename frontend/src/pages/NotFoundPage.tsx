import { Link } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { useDocumentTitle } from "../hooks";
import { LogoMark } from "../components/LogoMark";

export function NotFoundPage() {
  useDocumentTitle("Page not found");

  return (
    <div className="shell page not-found">
      <div className="not-found__mark" aria-hidden="true">
        <LogoMark size={64} />
        <span>404</span>
      </div>
      <p className="eyebrow">No page here</p>
      <h1>This page is quiet.</h1>
      <p className="not-found__lede">
        The page may have moved, or it may belong to a place that was removed. Nothing in your atlas has changed.
      </p>
      <div className="not-found__actions">
        <Link className="button button--primary" to="/">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to my atlas
        </Link>
        <Link className="button button--ghost" to="/about">
          <MapPin size={15} aria-hidden="true" />
          About Hush Atlas
        </Link>
      </div>
    </div>
  );
}
