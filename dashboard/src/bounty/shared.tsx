import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  Crosshair,
  FolderSearch,
  LogOut,
  PanelLeft,
  Target,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";
import { statusLabels } from "./data";
import "./bounty.css";
import ConsoleProvider from "./ConsoleProvider";

export function ErrorNote({ error }: { error: unknown }) {
  return error ? (
    <p className="b-error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`b-badge b-${value}`}>{statusLabels[value] || value}</span>
  );
}
export function Loading() {
  return (
    <div className="b-loading" role="status">
      Carregando sua pesquisa…
    </div>
  );
}
export function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="b-external"
    >
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}

export function BountyLayout() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const nav = [
    { to: "/", label: "Command center", icon: TerminalSquare },
    { to: "/overview", label: "Visão geral", icon: Compass },
    { to: "/programs", label: "Programas", icon: Target },
    { to: "/findings", label: "Achados e relatórios", icon: FolderSearch },
    { to: "/integrations", label: "Ferramentas e fontes", icon: BookOpen },
  ];
  return (
    <ConsoleProvider>
      <div className={`bounty-app ${open ? "b-nav-open" : ""}`}>
        <a className="b-skip" href="#research-content">
          Pular para conteúdo
        </a>
        <header className="b-mobile-bar">
          <button
            onClick={() => setOpen(!open)}
            aria-label="Abrir navegação"
            aria-expanded={open}
          >
            <PanelLeft size={20} />
          </button>
          <span>Ghosthunt</span>
        </header>
        <aside className="b-sidebar">
          <Link to="/" className="b-brand">
            <Crosshair size={25} strokeWidth={1.6} />
            <span>
              <span className="b-glitch">Ghosthunt_</span>
              <small>SECURITY RESEARCH // LOCAL</small>
            </span>
          </Link>
          <nav aria-label="Navegação principal">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                onClick={() => setOpen(false)}
              >
                <Icon size={18} strokeWidth={1.7} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="b-sidebar-footer">
            <p>
              OPERATOR SESSION
              <br />
              <span>Escopo → processo → evidência</span>
            </p>
            <button
              onClick={() => {
                localStorage.removeItem("ghosthunt_api_key");
                navigate("/login");
              }}
            >
              <LogOut size={16} /> Sair
            </button>
          </div>
        </aside>
        <main id="research-content" className="b-main">
          <div className="b-global-status">
            <span>
              <i />
              LOCAL WORKSPACE
            </span>
            <span>GHOSTHUNT / RESEARCH OPERATIONS</span>
            <Link to="/integrations">
              CONEXÕES <ArrowUpRight size={11} />
            </Link>
          </div>
          <Outlet />
        </main>
      </div>
    </ConsoleProvider>
  );
}
