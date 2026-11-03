import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { isRemoteApi } from "../api";
import { LogoMark } from "./LogoMark";

const links = [
  { to: "/", label: "Missions", end: true },
  { to: "/routes", label: "Routes", end: false },
  { to: "/archive", label: "My atlas", end: false },
  { to: "/comparisons", label: "Compare", end: false },
  { to: "/about", label: "About", end: false },
];

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <div className={`site${location.pathname === "/" ? " site--home" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="shell site-header__inner">
          <Link className="brand" to="/" aria-label="Hush Atlas, home">
            <LogoMark />
            <span className="brand__name">
              Hush <em>Atlas</em>
            </span>
          </Link>

          <nav
            className={`site-nav${menuOpen ? " is-open" : ""}`}
            id="site-navigation"
            aria-label="Primary"
          >
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `site-nav__link${isActive ? " is-active" : ""}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="site-header__side">
            <button
              type="button"
              className="menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="site-navigation"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <button
            type="button"
            className="nav-scrim"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
          />
        )}
      </header>

      <main id="main" className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="shell site-footer__inner">
          <div className="site-footer__brand">
            <LogoMark size={28} />
            <div>
              <p className="site-footer__name">Hush Atlas</p>
              <p className="site-footer__note">
                A field atlas of sound. Made for slow walks and curious
                ears.
              </p>
            </div>
          </div>
          <div className="site-footer__meta">
            <span>
              {isRemoteApi() ? "Archive on a hosted server" : "Runs on this device"}
            </span>
            <span>© {new Date().getFullYear()} Hush Atlas</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
